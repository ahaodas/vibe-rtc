import type { ButtonHTMLAttributes, ReactNode } from 'react'

type AppButtonProps = {
    children?: ReactNode
    testId?: string
} & ButtonHTMLAttributes<HTMLButtonElement>

export function AppButton({ children, className, testId, ...props }: AppButtonProps) {
    const composedClassName = className ? `cs-btn ${className}` : 'cs-btn'
    return (
        <button type="button" data-testid={testId} className={composedClassName} {...props}>
            {children}
        </button>
    )
}
