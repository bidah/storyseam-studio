import { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useColors } from '@/lib/colors';

const styles = StyleSheet.create((theme) => ({
  input: {
    minHeight: 44,
    borderRadius: 0, // square, like the web (design.md)
    borderWidth: 1,
    borderColor: theme.colors.input,
    backgroundColor: theme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.colors.foreground,
  },
  multiline: {
    minHeight: 96,
  },
}));

export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { style, ...props },
  ref,
) {
  const colors = useColors();
  return (
    <TextInput
      ref={ref}
      style={[styles.input, props.multiline && styles.multiline, style]}
      placeholderTextColor={colors.subtleForeground}
      {...props}
    />
  );
});
