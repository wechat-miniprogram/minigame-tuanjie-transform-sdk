import { GPU_SCORE_MAP } from './gpu-score-map';
export const GPU_TIER_HIGH = 3;
export const GPU_TIER_MID = 2;
export const GPU_TIER_LOW = 1;
export const GPU_TIER_HIGH_MIN_SCORE = 30000;
export const GPU_TIER_MID_MIN_SCORE = 10000;



function _normalizeName(name) {
    return String(name)
        .toLowerCase()
        .replace(/\(tm\)/g, ' ')
        .replace(/\(r\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
var _normalizedEntriesCache = null;
function _getNormalizedEntries() {
    if (_normalizedEntriesCache)
        return _normalizedEntriesCache;
    var entries = [];
    for (var k in GPU_SCORE_MAP) {
        if (!Object.prototype.hasOwnProperty.call(GPU_SCORE_MAP, k))
            continue;
        entries.push({ key: k, norm: _normalizeName(k), score: GPU_SCORE_MAP[k] });
    }
    
    entries.sort(function (a, b) { return b.norm.length - a.norm.length; });
    _normalizedEntriesCache = entries;
    return entries;
}
export function lookupGPUScore(renderer) {
    if (!renderer)
        return null;
    
    if (Object.prototype.hasOwnProperty.call(GPU_SCORE_MAP, renderer)) {
        return { key: renderer, score: GPU_SCORE_MAP[renderer] };
    }
    var norm = _normalizeName(renderer);
    if (!norm)
        return null;
    var entries = _getNormalizedEntries();
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        
        if (norm === e.norm)
            return { key: e.key, score: e.score };
        
        
        
        var idx = norm.indexOf(e.norm);
        if (idx === -1)
            continue;
        var before = (idx === 0) ? ' ' : norm.charAt(idx - 1);
        var end = idx + e.norm.length;
        var after = (end === norm.length) ? ' ' : norm.charAt(end);
        if (before === ' ' && after === ' ') {
            return { key: e.key, score: e.score };
        }
    }
    return null;
}
export function resolveGPUTier(score) {
    if (score >= GPU_TIER_HIGH_MIN_SCORE)
        return GPU_TIER_HIGH;
    if (score >= GPU_TIER_MID_MIN_SCORE)
        return GPU_TIER_MID;
    return GPU_TIER_LOW;
}



export function getRendererFromGL(gl) {
    if (!gl)
        return '';
    try {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg && dbg.UNMASKED_RENDERER_WEBGL != null) {
            var r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            if (r)
                return (typeof r === 'string') ? r : String(r);
        }
    }
    catch (_) { }
    try {
        
        var r2 = gl.getParameter(gl.RENDERER);
        if (r2)
            return (typeof r2 === 'string') ? r2 : String(r2);
    }
    catch (_) { }
    return '';
}
// ---------------------------------------------------------------
// 准入判定
// ---------------------------------------------------------------
function _admitByRenderer(renderer, minTier, allowUnknownGPU) {
    if (!renderer) {
        return {
            passed: !!allowUnknownGPU,
            renderer: '',
            tier: GPU_TIER_LOW,
            minTier: minTier,
            reason: 'renderer-unavailable',
        };
    }
    var hit = lookupGPUScore(renderer);
    if (!hit) {
        return {
            passed: !!allowUnknownGPU,
            renderer: renderer,
            tier: GPU_TIER_LOW,
            minTier: minTier,
            reason: 'gpu-not-in-map',
        };
    }
    var tier = resolveGPUTier(hit.score);
    var passed = tier >= minTier;
    return {
        passed: passed,
        renderer: renderer,
        matchedKey: hit.key,
        score: hit.score,
        tier: tier,
        minTier: minTier,
        reason: passed ? 'tier-ok' : 'tier-below-min',
    };
}
export function checkGPUAdmissionWithGL(gl, minTier, allowUnknownGPU) {
    return _admitByRenderer(getRendererFromGL(gl), minTier, allowUnknownGPU);
}
