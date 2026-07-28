// SemiPillButton — cross-platform entry (Android / web / anything that isn't
// iOS). Metro resolves semi-pill-button.ios.tsx first on iOS, where `glass`
// renders on an iOS 26 Liquid-Glass surface; everywhere else both variants are
// the bouncy flat fill from the base. Same props on both, so callers just
// `import { SemiPillButton } from '@/components/ui/semi-pill-button'`.
export {
  SemiPillButton,
  SEMI_PILL,
  semiPillStyles,
  type SemiPillButtonProps,
  type SemiPillVariant,
} from './semi-pill-button-base';
