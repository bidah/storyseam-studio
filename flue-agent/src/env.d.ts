// flue import attributes: `import x from './a.md' with { type: 'markdown' }` and
// `import s from './s/SKILL.md' with { type: 'skill' }`. Ambient decls so tsc
// resolves them; flue's build inlines the real contents.
declare module "*.md" {
  const content: string;
  export default content;
}
