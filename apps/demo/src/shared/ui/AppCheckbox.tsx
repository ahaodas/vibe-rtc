import type { InputHTMLAttributes, ReactNode } from 'react'

type AppCheckboxProps = {
    label: ReactNode
    wrapperClassName?: string
    testId?: string
    inputTestId?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function AppCheckbox({
    label,
    wrapperClassName,
    testId,
    inputTestId,
    className,
    ...props
}: AppCheckboxProps) {
    const composedWrapperClassName = wrapperClassName
        ? `cs-checkbox ${wrapperClassName}`
        : 'cs-checkbox'

    return (
        <label className={composedWrapperClassName} data-testid={testId}>
            <input type="checkbox" className={className} data-testid={inputTestId} {...props} />
            <span className="cs-checkbox__label">{label}</span>
        </label>
    )
}
