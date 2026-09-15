const BUSINESS_SEGMENTS = Object.freeze({
    KL: Object.freeze({ code: "KL", label: "Kaira Luxe" }),
    MENS: Object.freeze({ code: "MENS", label: "Mens Wear" }),
    KIDS: Object.freeze({ code: "KIDS", label: "Kids Wear" })
});

const BUSINESS_SEGMENT_CODES = Object.freeze(Object.keys(BUSINESS_SEGMENTS));
const BUSINESS_SEGMENT_LABELS = Object.freeze(
    Object.fromEntries(BUSINESS_SEGMENT_CODES.map(code => [BUSINESS_SEGMENTS[code].label, code]))
);

function normalizeBusinessSegment(value, { allowLabels = true } = {}) {
    const input = String(value == null ? "" : value).trim();
    if (BUSINESS_SEGMENT_CODES.includes(input)) return input;
    if (allowLabels && Object.prototype.hasOwnProperty.call(BUSINESS_SEGMENT_LABELS, input)) {
        return BUSINESS_SEGMENT_LABELS[input];
    }
    return null;
}

function businessSegmentLabel(code) {
    return BUSINESS_SEGMENTS[code]?.label || "";
}

module.exports = {
    BUSINESS_SEGMENTS,
    BUSINESS_SEGMENT_CODES,
    normalizeBusinessSegment,
    businessSegmentLabel
};
