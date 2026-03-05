import { useEffect, useRef, useState } from 'react'

type SegmentedProgressBarProps = {
    ratio: number
    className?: string
    stepPx?: number
    testId?: string
    barTestId?: string
}

export function SegmentedProgressBar({
    ratio,
    className,
    stepPx = 10,
    testId,
    barTestId,
}: SegmentedProgressBarProps) {
    const [trackWidthPx, setTrackWidthPx] = useState(0)
    const trackRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const node = trackRef.current
        if (!node) return

        const updateWidth = () => {
            setTrackWidthPx(Math.max(0, Math.floor(node.clientWidth)))
        }

        updateWidth()

        const observer = new ResizeObserver(updateWidth)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
    const segmentCount = Math.max(1, Math.floor(trackWidthPx / stepPx))
    const filledSegments = Math.floor(safeRatio * segmentCount)
    const widthPercent = (filledSegments / segmentCount) * 100

    return (
        <div ref={trackRef} className={className} data-testid={testId}>
            <div className="bars" style={{ width: `${widthPercent}%` }} data-testid={barTestId} />
        </div>
    )
}
