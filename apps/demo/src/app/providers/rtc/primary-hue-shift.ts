const PRIMARY_HUE_SHIFT_VARS = [
    '--bg',
    '--secondary-bg',
    '--accent',
    '--secondary-accent',
    '--border-light',
    '--border-dark',
    '--slider',
    '--scrollbar-track',
] as const

const HUE_SHIFT_RANGE_DEG = 45

function parseHexColor(raw: string): { r: number; g: number; b: number } | null {
    if (!raw.startsWith('#')) return null

    const hex = raw.slice(1).trim()

    if (hex.length === 3) {
        const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16)
        const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16)
        const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16)

        if ([r, g, b].some((value) => Number.isNaN(value))) return null

        return { r, g, b }
    }

    if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16)
        const g = Number.parseInt(hex.slice(2, 4), 16)
        const b = Number.parseInt(hex.slice(4, 6), 16)

        if ([r, g, b].some((value) => Number.isNaN(value))) return null

        return { r, g, b }
    }

    return null
}

function rgbToHsl(r: number, g: number, b: number) {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2

    if (max === min) return { h: 0, s: 0, l }

    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    let h = 0
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4

    h /= 6

    return { h: h * 360, s, l }
}

function hslToRgb(h: number, s: number, l: number) {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const hp = h / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))

    let rn = 0
    let gn = 0
    let bn = 0

    if (hp >= 0 && hp < 1) {
        rn = c
        gn = x
    } else if (hp >= 1 && hp < 2) {
        rn = x
        gn = c
    } else if (hp >= 2 && hp < 3) {
        gn = c
        bn = x
    } else if (hp >= 3 && hp < 4) {
        gn = x
        bn = c
    } else if (hp >= 4 && hp < 5) {
        rn = x
        bn = c
    } else {
        rn = c
        bn = x
    }

    const m = l - c / 2

    return {
        r: Math.round((rn + m) * 255),
        g: Math.round((gn + m) * 255),
        b: Math.round((bn + m) * 255),
    }
}

function toHex(value: number) {
    return value.toString(16).padStart(2, '0')
}

export function applyGlobalPrimaryHueShift() {
    const root = document.documentElement
    const styles = getComputedStyle(root)
    const shift = Math.floor(Math.random() * (HUE_SHIFT_RANGE_DEG * 2 + 1)) - HUE_SHIFT_RANGE_DEG

    for (const varName of PRIMARY_HUE_SHIFT_VARS) {
        const raw = styles.getPropertyValue(varName).trim()
        const rgb = parseHexColor(raw)
        if (!rgb) continue

        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
        const shiftedHue = (hsl.h + shift + 360) % 360
        const shiftedRgb = hslToRgb(shiftedHue, hsl.s, hsl.l)

        root.style.setProperty(
            varName,
            `#${toHex(shiftedRgb.r)}${toHex(shiftedRgb.g)}${toHex(shiftedRgb.b)}`,
        )
    }
}
