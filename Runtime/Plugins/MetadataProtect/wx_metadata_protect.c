/*
 * wx_metadata_protect.c
 *
 * Native metadata decryption runtime for Unity WebGL / WeChat Mini Game.
 * Compiled into webgl.wasm via Unity PluginImporter (C source plugin).
 *
 * Contains a fixed-length key slot (256 bytes) initialized with placeholder
 * magic. After each build, WXMetadataEncryptor patches this slot in the
 * final webgl.wasm binary with per-build random key/nonce/metadata info,
 * then applies a position-dependent XOR scramble so that the slot's magic
 * pattern no longer appears in the final binary.
 *
 * At runtime, wrt0() is called from framework JS right before callMain(args).
 * It descrambles the slot, reads key material, decrypts global-metadata.dat
 * in Emscripten FS using ChaCha20, verifies IL2CPP magic, and writes it back.
 *
 * Anti-analysis hardening:
 *   - Slot is post-patch scrambled: HEAD/TAIL magic not searchable in binary.
 *   - ChaCha20 sigma constants are XOR-masked to avoid pattern matching.
 *   - Export function name is generic to hide intent.
 *   - After decryption, all key material and intermediate state are zeroed.
 */

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

/* ================================================================
 * Key Slot Layout (256 bytes, fixed length)
 * ================================================================
 * Offset  Size   Field
 * 0       16     HEAD_MAGIC
 * 16       1     STATUS  (0x00=placeholder, 0xA5=active/patched)
 * 17       1     VERSION (0x01)
 * 18       2     RESERVED
 * 20      32     KEY     (ChaCha20 256-bit key)
 * 52      12     NONCE   (ChaCha20 96-bit nonce)
 * 64       4     META_SIZE (LE uint32, expected metadata file size)
 * 68       1     PATH_LEN  (length of metadata path string)
 * 69     127     PATH      (null-padded, UTF-8, with leading /)
 * 196     44     RESERVED_2 (for future use)
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
#define WX_SLOT_TAIL_OFFSET      240

#define WX_SLOT_STATUS_PLACEHOLDER 0x00
#define WX_SLOT_STATUS_ACTIVE      0xA5
#define WX_SLOT_VERSION_1          0x01

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
 * Exported entry point (generic name to avoid revealing intent)
 * ================================================================ */

EMSCRIPTEN_KEEPALIVE
int wrt0(void)
{
    uint8_t slot[WX_SLOT_SIZE];
    uint8_t status;
    uint8_t key[WX_SLOT_KEY_SIZE];
    uint8_t nonce[WX_SLOT_NONCE_SIZE];
    uint32_t expected_size;
    uint8_t path_len;
    char path[WX_SLOT_PATH_MAX + 1];
    FILE *fp;
    long file_size;
    uint8_t *buf;
    size_t n;
    int result;

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
            return WX_INACTIVE;
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
                return WX_INACTIVE; /* unpatched dev build, no-op */
            /* Raw slot has ACTIVE status but failed descramble — corrupt */
            return WX_ERR_SLOT_CORRUPT;
        }
        secure_zero(slot, sizeof(slot));
        return WX_ERR_SLOT_CORRUPT;
    }

    /* 1. Copy key material from descrambled slot to local variables */
    memcpy(key, slot + WX_SLOT_KEY_OFFSET, WX_SLOT_KEY_SIZE);
    memcpy(nonce, slot + WX_SLOT_NONCE_OFFSET, WX_SLOT_NONCE_SIZE);
    expected_size = load_le32(slot + WX_SLOT_META_SIZE_OFFSET);
    path_len = slot[WX_SLOT_PATH_LEN_OFFSET];

    /* Zero the descrambled slot immediately — key has been copied out */
    secure_zero(slot, sizeof(slot));

    if (path_len == 0 || path_len > WX_SLOT_PATH_MAX) {
        result = WX_ERR_SLOT_CORRUPT;
        goto cleanup;
    }

    /* Re-descramble just the path bytes (slot already zeroed, read from _ds) */
    {
        int pi;
        for (pi = 0; pi < path_len; pi++) {
            path[pi] = (char)(((uint8_t)_ds[WX_SLOT_PATH_OFFSET + pi])
                              ^ slot_mask(WX_SLOT_PATH_OFFSET + pi));
        }
        path[path_len] = '\0';
    }

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

    /* 6. Verify metadata magic after decryption */
    if (file_size < 4 ||
        buf[0] != VMAGIC[0] || buf[1] != VMAGIC[1] ||
        buf[2] != VMAGIC[2] || buf[3] != VMAGIC[3]) {
        secure_zero(buf, (size_t)file_size);
        free(buf);
        result = WX_ERR_MAGIC_MISMATCH;
        goto cleanup;
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
    secure_zero(key, sizeof(key));
    secure_zero(nonce, sizeof(nonce));
    return result;
}
