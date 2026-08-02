// Markdown imports. In flue 2 the SPECIFIER decides what an import means —
// the import attributes (`with { type: 'skill' | 'markdown' }`) are gone — so
// the two shapes have to be declared separately here or every SKILL.md import
// mistypes as a plain string.
//
// A `SKILL.md` import packages its whole directory and yields a SkillReference
// for useSkill(); any other `.md` import is the file's text, inlined at build
// time. Ambient decls so tsc resolves them; the build supplies the contents.
declare module "*/SKILL.md" {
  const skill: import("@flue/runtime").SkillReference;
  export default skill;
}

declare module "*.md" {
  const content: string;
  export default content;
}
