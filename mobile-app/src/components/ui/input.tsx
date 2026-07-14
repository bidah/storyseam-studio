import { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';

export const Input = forwardRef<TextInput, TextInputProps & { className?: string }>(
  function Input({ className, ...props }, ref) {
    return (
      <TextInput
        ref={ref}
        className={cn(
          'min-h-11 rounded-xl border border-input bg-card px-3 py-2.5 text-[15px] text-foreground',
          props.multiline && 'min-h-24',
          className,
        )}
        placeholderTextColor="#71717a"
        {...props}
      />
    );
  },
);
