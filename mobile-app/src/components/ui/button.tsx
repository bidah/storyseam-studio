// Button — cross-platform entry (Android / web / anything that isn't iOS).
// Metro resolves button.ios.tsx first on iOS, where the button renders on an
// iOS 26 Liquid-Glass surface; everywhere else it's the plain Pressable from
// button-base. Same props on both, so callers just
// `import { Button } from '@/components/ui/button'`.
export { Button, buttonVariants, textVariants, type ButtonProps } from './button-base';
