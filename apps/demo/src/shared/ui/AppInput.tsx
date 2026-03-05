import type { InputHTMLAttributes } from 'react'

type AppInputProps = {
    testId?: string
} & InputHTMLAttributes<HTMLInputElement>

export function AppInput({ className, testId, ...props }: AppInputProps) {
    const composedClassName = className ? `${className} cs-input` : 'cs-input'
    return <input data-testid={testId} className={composedClassName} {...props} />
}
