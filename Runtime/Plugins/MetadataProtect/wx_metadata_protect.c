/*
 * wx_metadata_protect.c
 *
 * Native metadata decryption runtime for Unity WebGL / WeChat Mini Game.
 * Compiled into webgl.wasm via Unity PluginImporter (C source plugin).
 *
 * Encoding chain (build time, WXMetadataEncryptor.cs):
 *   name heap XOR → body format transform → header scramble → ChaCha20
 *
 * Decoding chain (runtime):
 *   wrt1 (LoadMetadataFile hijack):
 *     ChaCha20^-1 → header unscramble → body format^-1 → name heap XOR (re-garble)
 *   mc_init (MetadataCache::Initialize hijack):
 *     name heap XOR^-1 (restore plaintext just before IL2CPP reads names)
 *
 * wrt0 (JS-bridge fallback, writes plaintext back to disk):
 *   ChaCha20^-1 → header unscramble → body format^-1 → name heap XOR^-1 → fwrite
 *
 * Anti-analysis hardening:
 *   - Slot is post-patch scrambled: HEAD/TAIL magic not searchable in binary.
 *   - ChaCha20 sigma constants are XOR-masked to avoid pattern matching.
 *   - Export function names are generic to hide intent.
 *   - After use, all key material and intermediate state are zeroed.
 */

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/mman.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

/* ================================================================
 * Key Slot Layout (256 bytes, fixed length)
 * ================================================================
 * Offset  Size   Field
 * 0       16     HEAD_MAGIC
 * 16       1     STATUS  (0x00=placeholder, 0xA5=active/patched)
 * 17       1     VERSION (0x04)
 * 18       2     RESERVED
 * 20      32     KEY     (ChaCha20 256-bit key)
 * 52      12     NONCE   (ChaCha20 96-bit nonce)
 * 64       4     META_SIZE (LE uint32, expected metadata file size)
 * 68       1     PATH_LEN  (length of metadata path string)
 * 69     127     PATH      (null-padded, UTF-8, with leading /)
 * 196      8     FMT_SEED   (custom-format seed, drives permutation + mask)
 * 204      4     FMT_WINDOW (LE uint32, header window actually transformed)
 * 208      1     FMT_FLAGS  (bit0=struct transform, bit1=header scramble)
 * 209      4     NAME_HEAP_OFF  (LE uint32, string name heap offset in metadata)
 * 213      4     NAME_HEAP_SIZE (LE uint32, string name heap byte size)
 * 217      1     NAME_HEAP_FLAGS (bit0 = name heap XOR applied)
 * 218     22     RESERVED_2
 * 240     16     TAIL_MAGIC
 * ================================================================
 * After patch, the entire 256 bytes are XOR'd with a position-dependent
 * mask so that HEAD/TAIL magic are not directly searchable in the binary.
 * ================================================================ */

#define WX_SLOT_SIZE             256
#define WX_SLOT_STATUS_OFFSET     16
#define WX_SLOT_VERSION_OFFSET    17
#define WX_SLOT_KEY_OFFSET        20
#define WX_SLOT_KEY_SIZE          32
#define WX_SLOT_NONCE_OFFSET      52
#define WX_SLOT_NONCE_SIZE        12
#define WX_SLOT_META_SIZE_OFFSET  64
#define WX_SLOT_PATH_LEN_OFFSET   68
#define WX_SLOT_PATH_OFFSET       69
#define WX_SLOT_PATH_MAX         127
#define WX_SLOT_FMT_SEED_OFFSET  196
#define WX_SLOT_FMT_SEED_SIZE      8
#define WX_SLOT_FMT_WINDOW_OFFSET 204
#define WX_SLOT_FMT_FLAGS_OFFSET  208
#define WX_SLOT_TAIL_OFFSET      240

#define WX_SLOT_STATUS_PLACEHOLDER 0x00
#define WX_SLOT_STATUS_ACTIVE      0xA5
#define WX_SLOT_VERSION_4          0x04  /* 加密 + 格式变换 + header 打乱 + name heap XOR */

/* FMT flags */
#define WX_FMT_FLAG_STRUCT         0x01  /* header struct transform applied */
#define WX_FMT_FLAG_HDR            0x02  /* Il2CppGlobalMetadataHeader scrambled (256B) */
/* Custom-format header window upper bound. Must match
 * WXMetadataEncryptor.cs HEADER_WINDOW. Actual value stored in slot. */
#define WX_HEADER_WINDOW          4096

/* Metadata header (Il2CppGlobalMetadataHeader, 256B) scramble key.
 * Must match WXMetadataEncryptor.cs HEADER_MASK_XOR. */
#define WX_HEADER_MASK_XOR 0xA5B1C2D3E4F50617ULL

/* Error codes */
#define WX_OK                    0
#define WX_INACTIVE              0  /* slot not patched, treated as no-op */
#define WX_ERR_SLOT_CORRUPT     -1
#define WX_ERR_FILE_OPEN        -2
#define WX_ERR_FILE_SIZE        -3
#define WX_ERR_FILE_READ        -4
#define WX_ERR_MAGIC_MISMATCH   -5
#define WX_ERR_FILE_WRITE       -6
#define WX_ERR_ALLOC            -7
#define WX_ERR_FILE_SEEK        -8

/* IL2CPP metadata magic: 0xFAB11BAF little-endian */
static const uint8_t VMAGIC[4] = { 0xAF, 0x1B, 0xB1, 0xFA };

/*
 * Shared state between wrt1() and mc_init().
 * wrt1() stores a pointer to the MAP_PRIVATE buffer it returns to IL2CPP,
 * along with the name-heap coordinates and the derived ChaCha20 sub-key.
 * mc_init() decrypts the name heap directly in that buffer.
 * Zeroed by mc_init() after use.
 */
static uint8_t  *g_meta_buf          = NULL;
static uint32_t  g_meta_nh_off       = 0;
static uint32_t  g_meta_nh_size      = 0;
static uint8_t   g_meta_nh_key[32]   = {0};
static uint8_t   g_meta_nh_nonce[12] = {0};

/* Head and tail magic (slot boundary markers).
 * Must match WXMetadataEncryptor.cs SLOT_HEAD_MAGIC / SLOT_TAIL_MAGIC. */
static const uint8_t MARK_H[16] = {
    0x7A, 0xB3, 0x9F, 0x12, 0xE4, 0x57, 0x58, 0x4D,
    0x50, 0xC8, 0x6D, 0xA1, 0x3E, 0xF0, 0x85, 0x2B
};
static const uint8_t MARK_T[16] = {
    0x2B, 0x85, 0xF0, 0x3E, 0xA1, 0x6D, 0xC8, 0x50,
    0x4D, 0x58, 0x57, 0xE4, 0x12, 0x9F, 0xB3, 0x7A
};

/*
 * The actual key slot, initialized with placeholder data.
 * After IL2CPP/Emscripten link, WXMetadataEncryptor:
 *   1) searches for HEAD_MAGIC to locate this region
 *   2) patches key/nonce/path/status in-place
 *   3) XOR-scrambles the entire 256 bytes with slot_mask()
 *
 * volatile: prevent compiler from constant-folding or eliminating the data.
 */
static volatile uint8_t _ds[WX_SLOT_SIZE] = {
    /* 0-15: HEAD_MAGIC */
    0x7A, 0xB3, 0x9F, 0x12, 0xE4, 0x57, 0x58, 0x4D,
    0x50, 0xC8, 0x6D, 0xA1, 0x3E, 0xF0, 0x85, 0x2B,
    /* 16: STATUS=placeholder, 17: VERSION=1, 18-19: reserved */
    0x00, 0x01, 0x00, 0x00,
    /* 20-51: KEY (32 bytes placeholder zeros) */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    /* 52-63: NONCE (12 bytes placeholder zeros) */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    /* 64-67: META_SIZE (LE uint32 = 0) */
    0x00, 0x00, 0x00, 0x00,
    /* 68: PATH_LEN = 0 */
    0x00,
    /* 69-195: PATH (127 bytes zeros) */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    /* 196-239: RESERVED_2 (44 bytes) */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    /* 240-255: TAIL_MAGIC */
    0x2B, 0x85, 0xF0, 0x3E, 0xA1, 0x6D, 0xC8, 0x50,
    0x4D, 0x58, 0x57, 0xE4, 0x12, 0x9F, 0xB3, 0x7A
};

/* ================================================================
 * Helpers
 * ================================================================ */

static inline uint32_t load_le32(const uint8_t *p)
{
    return (uint32_t)p[0]
        | ((uint32_t)p[1] << 8)
        | ((uint32_t)p[2] << 16)
        | ((uint32_t)p[3] << 24);
}

static inline void store_le32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v);
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

static void secure_zero(volatile void *p, size_t n)
{
    volatile uint8_t *b = (volatile uint8_t *)p;
    while (n--) *b++ = 0;
}

/* ================================================================
 * Slot scramble/descramble
 * ================================================================
 * Position-dependent XOR mask. After the Editor patches key/nonce
 * into the slot, it XOR's every byte with slot_mask(i). At runtime,
 * the same XOR reverses the transform.
 *
 * Must match WXMetadataEncryptor.cs SlotMask().
 * ================================================================ */

static inline uint8_t slot_mask(int i)
{
    uint32_t v = ((uint32_t)i + 1u) * 0x9E3779B9u;
    v ^= v >> 16;
    return (uint8_t)(v & 0xFF);
}

/* Descramble slot into caller-provided buffer */
static void descramble_slot(uint8_t *out)
{
    int i;
    for (i = 0; i < WX_SLOT_SIZE; i++)
        out[i] = ((uint8_t)_ds[i]) ^ slot_mask(i);
}

/* ================================================================
 * ChaCha20 (RFC 8439)
 * ================================================================ */

#define ROTL32(v, n) (((v) << (n)) | ((v) >> (32 - (n))))

#define QR(s, a, b, c, d)         \
    s[a] += s[b]; s[d] ^= s[a]; s[d] = ROTL32(s[d], 16); \
    s[c] += s[d]; s[b] ^= s[c]; s[b] = ROTL32(s[b], 12); \
    s[a] += s[b]; s[d] ^= s[a]; s[d] = ROTL32(s[d],  8); \
    s[c] += s[d]; s[b] ^= s[c]; s[b] = ROTL32(s[b],  7);

/*
 * ChaCha20 sigma constants, XOR-masked to avoid pattern matching.
 * Standard values: 0x61707865, 0x3320646E, 0x79622D32, 0x6B206574
 * ("expand 32-byte k")
 * volatile mask prevents compiler from constant-folding back to originals.
 */
static volatile uint32_t _sm = 0xC3A5B7D1u;
static const uint32_t _se[4] = {
    0xA2D5CFB4u, /* 0x61707865 ^ 0xC3A5B7D1 */
    0xF085D3BFu, /* 0x3320646E ^ 0xC3A5B7D1 */
    0xBAC79AE3u, /* 0x79622D32 ^ 0xC3A5B7D1 */
    0xA885D2A5u  /* 0x6B206574 ^ 0xC3A5B7D1 */
};

static void sc_process(uint8_t *data, uint32_t data_len,
                       const uint8_t *key, const uint8_t *nonce)
{
    uint32_t state[16];
    uint32_t work[16];
    uint8_t  ks[64];
    uint32_t pos, block_end, i, r;
    uint32_t sm;

    /* Recover sigma constants at runtime */
    sm = _sm;
    state[0]  = _se[0] ^ sm;
    state[1]  = _se[1] ^ sm;
    state[2]  = _se[2] ^ sm;
    state[3]  = _se[3] ^ sm;

    for (i = 0; i < 8; i++)
        state[4 + i] = load_le32(key + i * 4);
    state[12] = 0;
    for (i = 0; i < 3; i++)
        state[13 + i] = load_le32(nonce + i * 4);

    pos = 0;
    while (pos < data_len) {
        memcpy(work, state, sizeof(state));
        for (r = 0; r < 10; r++) {
            QR(work, 0, 4,  8, 12);
            QR(work, 1, 5,  9, 13);
            QR(work, 2, 6, 10, 14);
            QR(work, 3, 7, 11, 15);
            QR(work, 0, 5, 10, 15);
            QR(work, 1, 6, 11, 12);
            QR(work, 2, 7,  8, 13);
            QR(work, 3, 4,  9, 14);
        }
        for (i = 0; i < 16; i++)
            work[i] += state[i];
        for (i = 0; i < 16; i++)
            store_le32(ks + i * 4, work[i]);

        block_end = pos + 64;
        if (block_end > data_len) block_end = data_len;
        for (i = pos; i < block_end; i++)
            data[i] ^= ks[i - pos];

        state[12]++;
        pos += 64;
    }

    secure_zero(state, sizeof(state));
    secure_zero(work, sizeof(work));
    secure_zero(ks, sizeof(ks));
}

/* ================================================================
 * Custom format transform (reverse direction)
 * ================================================================
 * Mirror of WXMetadataEncryptor.cs ApplyCustomFormatEncode().
 * The Editor, before ChaCha20 encryption, transforms the first W bytes
 * ("header window") of the standard metadata:
 *   1) permute 4-byte blocks by a seed-derived permutation: out[i]=in[P[i]]
 *   2) XOR every byte with a seed-derived mask stream
 * Here, AFTER ChaCha20 decryption and BEFORE the IL2CPP magic check, we
 * reverse it (undo mask, then inverse-permute) to recover standard metadata.
 * ================================================================ */

static inline uint64_t load_le64(const uint8_t *p)
{
    return (uint64_t)p[0]
        | ((uint64_t)p[1] << 8)
        | ((uint64_t)p[2] << 16)
        | ((uint64_t)p[3] << 24)
        | ((uint64_t)p[4] << 32)
        | ((uint64_t)p[5] << 40)
        | ((uint64_t)p[6] << 48)
        | ((uint64_t)p[7] << 56);
}

/* SplitMix64 PRNG. Must match WXMetadataEncryptor.cs SplitMix64(). */
static uint64_t splitmix64(uint64_t *state)
{
    uint64_t z = (*state += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}

/*
 * Reverse the custom-format transform on data[0..window).
 * seed: 8-byte little-endian format seed.
 * window: multiple of 4, 0 < window <= size (caller guarantees).
 * Returns 0 on success, negative on internal error.
 */
/* Forward declarations for helpers defined later in this file */
static void unscramble_metadata_header(uint8_t *header, const uint8_t *seed);

static int reverse_custom_format(uint8_t *data, uint32_t window, const uint8_t *seed)
{
    static uint16_t perm[WX_HEADER_WINDOW / 4];
    static uint8_t  tmp[WX_HEADER_WINDOW];
    uint32_t n_blocks, i;
    uint64_t seed64, state, mask_state, block;

    if (window == 0 || (window & 3u) != 0 || window > WX_HEADER_WINDOW)
        return -1;

    seed64 = load_le64(seed);

    /* --- step 2 inverse: XOR mask stream (self-inverse) --- */
    mask_state = seed64 ^ 0xD1B54A32D192ED03ULL;
    block = 0;
    for (i = 0; i < window; i++) {
        if ((i & 7u) == 0)
            block = splitmix64(&mask_state);
        data[i] ^= (uint8_t)((block >> ((i & 7u) * 8)) & 0xFFu);
    }

    /* --- rebuild permutation (Fisher-Yates), identical to encoder --- */
    n_blocks = window / 4u;
    for (i = 0; i < n_blocks; i++)
        perm[i] = (uint16_t)i;
    state = seed64;
    if (n_blocks >= 2) {
        uint32_t k;
        for (k = n_blocks - 1; k >= 1; k--) {
            uint64_t r = splitmix64(&state);
            uint32_t j = (uint32_t)(r % (uint64_t)(k + 1));
            uint16_t t = perm[k]; perm[k] = perm[j]; perm[j] = t;
            if (k == 1) break; /* avoid unsigned underflow */
        }
    }

    /* --- step 1 inverse: encoder did out[i]=in[perm[i]];
     *     so recover plain[perm[i]] = data[i] into tmp, then copy back. --- */
    for (i = 0; i < n_blocks; i++) {
        uint32_t dst = (uint32_t)perm[i] * 4u;
        uint32_t src = i * 4u;
        tmp[dst]     = data[src];
        tmp[dst + 1] = data[src + 1];
        tmp[dst + 2] = data[src + 2];
        tmp[dst + 3] = data[src + 3];
    }
    memcpy(data, tmp, window);

    secure_zero(tmp, window);
    return 0;
}

/* Name heap XOR slot fields (209..217, 9 bytes in RESERVED_2) */
#define WX_SLOT_NAME_HEAP_OFF_OFFSET  209
#define WX_SLOT_NAME_HEAP_SZ_OFFSET   213
#define WX_SLOT_NAME_HEAP_FLAGS_OFFSET 217
#define WX_NAME_HEAP_FLAG_XOR         0x01  /* name heap XOR applied */

/* Key slot material extracted by load_slot_material() */

typedef struct {
    uint8_t  key[WX_SLOT_KEY_SIZE];
    uint8_t  nonce[WX_SLOT_NONCE_SIZE];
    uint32_t expected_size;
    char     path[WX_SLOT_PATH_MAX + 1];
    uint8_t  fmt_flags;
    uint8_t  fmt_seed[WX_SLOT_FMT_SEED_SIZE];
    uint32_t fmt_window;
    /* Phase 2: name heap XOR */
    uint32_t name_heap_off;   /* byte offset of string name heap in (decrypted) metadata */
    uint32_t name_heap_size;  /* byte size of name heap */
    uint8_t  name_heap_flags; /* bit0: XOR applied */
} wx_slot_material;

/*
 * Descramble and validate the key slot, extracting all runtime material.
 * Returns:
 *   0          — slot active and material valid
 *   1          — slot inactive (unpatched dev build; caller treats as no-op)
 *   negative   — corrupt slot
 */
static int load_slot_material(wx_slot_material *m)
{
    uint8_t slot[WX_SLOT_SIZE];
    uint8_t status;

    /*
     * Try descrambled path first (normal patched build).
     * If that fails, check raw slot for unpatched placeholder (dev builds).
     */
    descramble_slot(slot);

    if (memcmp(slot, MARK_H, 16) == 0 &&
        memcmp(slot + WX_SLOT_TAIL_OFFSET, MARK_T, 16) == 0)
    {
        /* Slot was scrambled by patcher — use descrambled data */
        status = slot[WX_SLOT_STATUS_OFFSET];
        if (status != WX_SLOT_STATUS_ACTIVE) {
            secure_zero(slot, sizeof(slot));
            return 1;
        }
    }
    else
    {
        /* Descramble didn't produce valid markers.
         * Check if this is an unpatched build (raw placeholder). */
        if (memcmp((const void *)_ds, MARK_H, 16) == 0)
        {
            uint8_t raw_status = _ds[WX_SLOT_STATUS_OFFSET];
            secure_zero(slot, sizeof(slot));
            if (raw_status != WX_SLOT_STATUS_ACTIVE)
                return 1; /* unpatched dev build, no-op */
            /* Raw slot has ACTIVE status but failed descramble — corrupt */
            return WX_ERR_SLOT_CORRUPT;
        }
        secure_zero(slot, sizeof(slot));
        return WX_ERR_SLOT_CORRUPT;
    }

    memcpy(m->key, slot + WX_SLOT_KEY_OFFSET, WX_SLOT_KEY_SIZE);
    memcpy(m->nonce, slot + WX_SLOT_NONCE_OFFSET, WX_SLOT_NONCE_SIZE);
    m->expected_size = load_le32(slot + WX_SLOT_META_SIZE_OFFSET);

    /* Copy custom-format fields (VERSION>=2). For a v1 slot these bytes are
     * placeholder zeros → fmt_flags==0 → transform skipped (back-compat). */
    m->fmt_flags = slot[WX_SLOT_FMT_FLAGS_OFFSET];
    memcpy(m->fmt_seed, slot + WX_SLOT_FMT_SEED_OFFSET, WX_SLOT_FMT_SEED_SIZE);
    m->fmt_window = load_le32(slot + WX_SLOT_FMT_WINDOW_OFFSET);

    /* Phase 2: name heap XOR fields (VERSION>=4, zeros = no-op for older builds) */
    m->name_heap_off   = load_le32(slot + WX_SLOT_NAME_HEAP_OFF_OFFSET);
    m->name_heap_size  = load_le32(slot + WX_SLOT_NAME_HEAP_SZ_OFFSET);
    m->name_heap_flags = slot[WX_SLOT_NAME_HEAP_FLAGS_OFFSET];

    /* Re-descramble just the path bytes (raw _ds is position-XORed) */
    {
        uint8_t path_len = slot[WX_SLOT_PATH_LEN_OFFSET];
        int pi;
        if (path_len == 0 || path_len > WX_SLOT_PATH_MAX) {
            secure_zero(slot, sizeof(slot));
            return WX_ERR_SLOT_CORRUPT;
        }
        for (pi = 0; pi < path_len; pi++) {
            m->path[pi] = (char)(((uint8_t)_ds[WX_SLOT_PATH_OFFSET + pi])
                                 ^ slot_mask(WX_SLOT_PATH_OFFSET + pi));
        }
        m->path[path_len] = '\0';
    }

    /* Zero the descrambled slot immediately — key has been copied out */
    secure_zero(slot, sizeof(slot));
    return 0;
}

/* wrt0: JS-bridge fallback. Decrypts metadata and writes plaintext back to disk. */
EMSCRIPTEN_KEEPALIVE
int wrt0(void)
{
    wx_slot_material m;
    uint8_t key[WX_SLOT_KEY_SIZE];
    uint8_t nonce[WX_SLOT_NONCE_SIZE];
    uint32_t expected_size;
    uint8_t fmt_flags;
    uint8_t fmt_seed[WX_SLOT_FMT_SEED_SIZE];
    uint32_t fmt_window;
    char path[WX_SLOT_PATH_MAX + 1];
    FILE *fp;
    long file_size;
    uint8_t *buf;
    size_t n;
    int result;

    /*
     * Load + validate slot material. Inactive slot (unpatched dev build)
     * is a no-op success; corrupt slot fails closed.
     */
    result = load_slot_material(&m);
    if (result == 1)
        return WX_INACTIVE;
    if (result != 0)
        return result;

    memcpy(key, m.key, WX_SLOT_KEY_SIZE);
    memcpy(nonce, m.nonce, WX_SLOT_NONCE_SIZE);
    expected_size = m.expected_size;
    fmt_flags = m.fmt_flags;
    memcpy(fmt_seed, m.fmt_seed, WX_SLOT_FMT_SEED_SIZE);
    fmt_window = m.fmt_window;
    memcpy(path, m.path, sizeof(path));

    /* 2. Open metadata file in Emscripten FS */
    fp = fopen(path, "rb");
    if (!fp) {
        result = WX_ERR_FILE_OPEN;
        goto cleanup;
    }

    /* 3. Check file size */
    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        result = WX_ERR_FILE_SEEK;
        goto cleanup;
    }
    file_size = ftell(fp);
    if (fseek(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        result = WX_ERR_FILE_SEEK;
        goto cleanup;
    }

    if (expected_size != 0 && (uint32_t)file_size != expected_size) {
        fclose(fp);
        result = WX_ERR_FILE_SIZE;
        goto cleanup;
    }

    /* 4. Read entire file */
    buf = (uint8_t *)malloc((size_t)file_size);
    if (!buf) {
        fclose(fp);
        result = WX_ERR_ALLOC;
        goto cleanup;
    }

    n = fread(buf, 1, (size_t)file_size, fp);
    fclose(fp);

    if (n != (size_t)file_size) {
        free(buf);
        result = WX_ERR_FILE_READ;
        goto cleanup;
    }

    /* 5. Decrypt */
    sc_process(buf, (uint32_t)file_size, key, nonce);

    /* 5a. Unscramble the metadata header (VERSION>=3, flag bit1).
     * STRICT REVERSE ORDER matches wrt1: chacha^-1 -> hdrX^-1 -> bodyW^-1.
     * Header unscramble MUST come before body transform. */
    if ((fmt_flags & WX_FMT_FLAG_HDR) != 0)
        unscramble_metadata_header(buf, fmt_seed);

    /* 5b. Reverse custom-format transform (VERSION>=2 builds).
     * After decryption the buffer is still the transformed metadata; undo the
     * header permutation + mask so IL2CPP receives standard-layout metadata. */
    if ((fmt_flags & WX_FMT_FLAG_STRUCT) != 0) {
        uint32_t win = fmt_window;
        if (win > (uint32_t)file_size) win = (uint32_t)file_size & ~3u;
        if (win >= 4) {
            if (reverse_custom_format(buf, win, fmt_seed) != 0) {
                secure_zero(buf, (size_t)file_size);
                free(buf);
                result = WX_ERR_SLOT_CORRUPT;
                goto cleanup;
            }
        }
    }
    secure_zero(fmt_seed, sizeof(fmt_seed));

    /* 6. Verify metadata magic after decryption */
    if (file_size < 4 ||
        buf[0] != VMAGIC[0] || buf[1] != VMAGIC[1] ||
        buf[2] != VMAGIC[2] || buf[3] != VMAGIC[3]) {
        secure_zero(buf, (size_t)file_size);
        free(buf);
        result = WX_ERR_MAGIC_MISMATCH;
        goto cleanup;
    }

    /* 6b. Phase 2: decrypt name heap before writing back to FS.
     * ChaCha20 is self-inverse: sc_process with same derived sub-key decrypts. */
    if ((m.name_heap_flags & WX_NAME_HEAP_FLAG_XOR) != 0 &&
        m.name_heap_off < (uint32_t)file_size &&
        m.name_heap_size > 0 &&
        m.name_heap_off + m.name_heap_size <= (uint32_t)file_size)
    {
        static const uint8_t NH_KEY_TWEAK[32] = {
            0x4E,0x48,0x5F,0x4B,0x45,0x59,0x5F,0x54,
            0x57,0x45,0x41,0x4B,0x5F,0x76,0x31,0x00,
            0xA3,0xB7,0xC1,0xD5,0xE9,0xFD,0x11,0x25,
            0x39,0x4D,0x61,0x75,0x89,0x9D,0xB1,0xC5
        };
        static const uint8_t NH_NONCE_TWEAK[12] = {
            0x4E,0x48,0x5F,0x4E,0x4F,0x4E,
            0x43,0x45,0x5F,0x76,0x31,0x00
        };
        uint8_t nh_key[32];
        uint8_t nh_nonce[12];
        uint32_t ti;
        for (ti = 0; ti < 32; ti++) nh_key[ti]   = m.key[ti]   ^ NH_KEY_TWEAK[ti];
        for (ti = 0; ti < 12; ti++) nh_nonce[ti]  = m.nonce[ti] ^ NH_NONCE_TWEAK[ti];
        sc_process(buf + m.name_heap_off, m.name_heap_size, nh_key, nh_nonce);
        secure_zero(nh_key,   32);
        secure_zero(nh_nonce, 12);
    }

    /* 7. Write decrypted metadata back */
    fp = fopen(path, "wb");
    if (!fp) {
        secure_zero(buf, (size_t)file_size);
        free(buf);
        result = WX_ERR_FILE_WRITE;
        goto cleanup;
    }

    n = fwrite(buf, 1, (size_t)file_size, fp);
    fflush(fp);
    fclose(fp);

    if (n != (size_t)file_size) {
        secure_zero(buf, (size_t)file_size);
        free(buf);
        result = WX_ERR_FILE_WRITE;
        goto cleanup;
    }

    secure_zero(buf, (size_t)file_size);
    free(buf);
    result = WX_OK;

cleanup:
    secure_zero(&m, sizeof(m));
    return result;
}

/* ================================================================
 * Helpers shared by wrt1 and mc_init
 * ================================================================ */

/* Inverse of WXMetadataEncryptor.cs ScrambleMetadataHeader (self-inverse XOR). */
static void unscramble_metadata_header(uint8_t *header, const uint8_t *seed)
{
    uint64_t mask_state = load_le64(seed) ^ WX_HEADER_MASK_XOR;
    uint64_t block = 0;
    uint32_t i;
    for (i = 0; i < 256u; i++) {
        if ((i & 7u) == 0)
            block = splitmix64(&mask_state);
        header[i] ^= (uint8_t)((block >> ((i & 7u) * 8)) & 0xFFu);
    }
}

/* ================================================================
 * mc_init: decrypt name heap (MetadataCache::Initialize hijack)
 * ================================================================
 * wrt1 ChaCha20-encrypted the name heap and stashed the sub-key in
 * g_meta_nh_key/nonce. ChaCha20 is self-inverse: sc_process decrypts.
 * Signature: () -> i32  (matches MetadataCache::Initialize)
 * ================================================================ */
EMSCRIPTEN_KEEPALIVE
int mc_init(void)
{
    if (g_meta_buf == NULL || g_meta_nh_size == 0)
        return 0;

    sc_process(g_meta_buf + g_meta_nh_off, g_meta_nh_size,
               g_meta_nh_key, g_meta_nh_nonce);

    g_meta_buf     = NULL;
    g_meta_nh_off  = 0;
    g_meta_nh_size = 0;
    secure_zero(g_meta_nh_key,   sizeof(g_meta_nh_key));
    secure_zero(g_meta_nh_nonce, sizeof(g_meta_nh_nonce));
    return 0;
}

/* ================================================================
 * wrt1: LoadMetadataFile hijack (Route A)
 * ================================================================
 * Replaces il2cpp::vm::MetadataLoader::LoadMetadataFile(const char*)
 * via build-time WASM body rewrite. Signature: const char* -> void*.
 *
 * Decoding chain: ChaCha20^-1 → header unscramble → body format^-1
 *   → name heap XOR (garble names, stash ptr for mc_init)
 * Returns the MAP_PRIVATE mmap buffer to IL2CPP.
 * ================================================================ */

EMSCRIPTEN_KEEPALIVE
void *wrt1(const char *fileName)
{
    wx_slot_material m;
    struct stat st;
    uint8_t *buf;
    size_t file_size;
    uint32_t win;
    void *map;
    int fd;
    int rc;

    (void)fileName; /* the path comes from the key slot */

    /* Inactive slot never happens when the hijack is armed (the Editor only
     * rewrites the loader body after patching an active slot). Fail closed. */
    rc = load_slot_material(&m);
    if (rc != 0)
        return NULL;

    fd = open(m.path, O_RDONLY);
    if (fd < 0)
        goto fail;

    if (fstat(fd, &st) != 0)
        goto fail;
    if (m.expected_size != 0 && (uint32_t)st.st_size != m.expected_size)
        goto fail;
    file_size = (size_t)st.st_size;

    /* MAP_PRIVATE + PROT_WRITE: decode in place without touching the file */
    map = mmap(NULL, file_size, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
    if (map == MAP_FAILED)
        goto fail;
    close(fd);
    fd = -1;
    buf = (uint8_t *)map;

    /* 1. ChaCha20 decrypt in place */
    sc_process(buf, (uint32_t)file_size, m.key, m.nonce);

    /* 2. Unscramble the metadata header (flag bit1).
     * STRICT REVERSE ORDER of encoding (bodyW -> hdrX -> chacha):
     * decode = chacha^-1 -> hdrX^-1 -> bodyW^-1. The header scramble must be
     * undone BEFORE the body transform, because the body transform window
     * covers the header bytes and does not commute with the header XOR. */
    if ((m.fmt_flags & WX_FMT_FLAG_HDR) != 0)
        unscramble_metadata_header(buf, m.fmt_seed);

    /* 3. Reverse body format transform (VERSION>=2) */
    if ((m.fmt_flags & WX_FMT_FLAG_STRUCT) != 0) {
        win = m.fmt_window;
        if (win > (uint32_t)file_size) win = (uint32_t)file_size & ~3u;
        if (win >= 4) {
            if (reverse_custom_format(buf, win, m.fmt_seed) != 0)
                goto fail_mapped;
        }
    }

    /* 4. Verify IL2CPP magic before returning to IL2CPP */
    if (file_size < 4 ||
        buf[0] != VMAGIC[0] || buf[1] != VMAGIC[1] ||
        buf[2] != VMAGIC[2] || buf[3] != VMAGIC[3])
        goto fail_mapped;

    /* 5. Phase 2: ChaCha20-encrypt name heap (class/method names → cipher).
     * Key derivation: domain-separate from bulk key via XOR tweak constants.
     * Self-inverse: mc_init() calls sc_process again to decrypt. */
    if ((m.name_heap_flags & WX_NAME_HEAP_FLAG_XOR) != 0 &&
        m.name_heap_off < (uint32_t)file_size &&
        m.name_heap_size > 0 &&
        m.name_heap_off + m.name_heap_size <= (uint32_t)file_size)
    {
        static const uint8_t NH_KEY_TWEAK[32] = {
            0x4E,0x48,0x5F,0x4B,0x45,0x59,0x5F,0x54,
            0x57,0x45,0x41,0x4B,0x5F,0x76,0x31,0x00,
            0xA3,0xB7,0xC1,0xD5,0xE9,0xFD,0x11,0x25,
            0x39,0x4D,0x61,0x75,0x89,0x9D,0xB1,0xC5
        };
        static const uint8_t NH_NONCE_TWEAK[12] = {
            0x4E,0x48,0x5F,0x4E,0x4F,0x4E,
            0x43,0x45,0x5F,0x76,0x31,0x00
        };
        uint8_t nh_key[32];
        uint8_t nh_nonce[12];
        uint32_t ti;
        for (ti = 0; ti < 32; ti++) nh_key[ti]   = m.key[ti]   ^ NH_KEY_TWEAK[ti];
        for (ti = 0; ti < 12; ti++) nh_nonce[ti]  = m.nonce[ti] ^ NH_NONCE_TWEAK[ti];

        sc_process(buf + m.name_heap_off, m.name_heap_size, nh_key, nh_nonce);

        g_meta_buf     = buf;
        g_meta_nh_off  = m.name_heap_off;
        g_meta_nh_size = m.name_heap_size;
        memcpy(g_meta_nh_key,   nh_key,   32);
        memcpy(g_meta_nh_nonce, nh_nonce, 12);
        secure_zero(nh_key,   32);
        secure_zero(nh_nonce, 12);
    }

    secure_zero(&m, sizeof(m));
    return map;

fail_mapped:
    munmap(map, file_size);
fail:
    if (fd >= 0)
        close(fd);
    secure_zero(&m, sizeof(m));
    return NULL;
}
