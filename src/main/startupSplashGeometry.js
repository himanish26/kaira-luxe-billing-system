"use strict";

const DEFAULT_SPLASH_MARGIN = 24;

function calculateStartupSplashBounds(requiredSize, workArea, margin = DEFAULT_SPLASH_MARGIN) {
    const requiredWidth = Math.ceil(Number(requiredSize && requiredSize.width));
    const requiredHeight = Math.ceil(Number(requiredSize && requiredSize.height));
    const areaX = Number(workArea && workArea.x);
    const areaY = Number(workArea && workArea.y);
    const areaWidth = Math.floor(Number(workArea && workArea.width));
    const areaHeight = Math.floor(Number(workArea && workArea.height));
    const safeMargin = Math.max(0, Number(margin) || 0);

    if (![requiredWidth, requiredHeight, areaX, areaY, areaWidth, areaHeight].every(Number.isFinite) ||
        requiredWidth < 1 || requiredHeight < 1 || areaWidth < 1 || areaHeight < 1) {
        throw new TypeError("Startup splash geometry requires positive content and work-area dimensions.");
    }

    const horizontalMargin = Math.min(safeMargin, Math.max(0, (areaWidth - 1) / 2));
    const verticalMargin = Math.min(safeMargin, Math.max(0, (areaHeight - 1) / 2));
    const availableWidth = Math.max(1, Math.floor(areaWidth - horizontalMargin * 2));
    const availableHeight = Math.max(1, Math.floor(areaHeight - verticalMargin * 2));
    const scale = Math.min(1, availableWidth / requiredWidth, availableHeight / requiredHeight);
    const width = Math.max(1, Math.ceil(requiredWidth * scale));
    const height = Math.max(1, Math.ceil(requiredHeight * scale));

    return {
        x: Math.round(areaX + (areaWidth - width) / 2),
        y: Math.round(areaY + (areaHeight - height) / 2),
        width,
        height,
        scale,
        requiredWidth,
        requiredHeight,
        availableWidth,
        availableHeight
    };
}

module.exports = {
    DEFAULT_SPLASH_MARGIN,
    calculateStartupSplashBounds
};
