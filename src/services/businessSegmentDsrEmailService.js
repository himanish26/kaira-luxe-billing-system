function money(value) {
    return `₹${Number(value || 0).toFixed(2)}`;
}

function buildBusinessSegmentDsrEmailText(payload) {
    const lines = [
        "KAIRA LUXE  KLBS SEGMENT DSR",
        "",
        `Business Date: ${payload.businessDate}`,
        `Close Sequence: ${payload.closeSequence}`,
        `Report Status: ${payload.reportStatus}`,
        ""
    ];
    for (const segment of [payload.segments.KL, payload.segments.MENS, payload.segments.KIDS]) {
        lines.push(
            segment.label,
            `Sales: ${money(segment.sales)}`,
            `Qty: ${segment.qty}`,
            `Bills: ${segment.bills}`,
            `ATV: ${money(segment.atv)}`,
            `UPT: ${Number(segment.upt || 0).toFixed(2)}`,
            ""
        );
    }
    lines.push(
        `Data Quality: ${payload.dataQuality.complete ? "COMPLETE" : "INCOMPLETE"}`,
        `Reconciliation: ${payload.dataQuality.reconciliationClassified ? "PASS" : "INCOMPLETE"}`,
        `KLBS Version: ${payload.klbsVersion}`,
        `Generated At: ${payload.generatedAt}`
    );
    return lines.join("\n");
}

module.exports = { buildBusinessSegmentDsrEmailText };
