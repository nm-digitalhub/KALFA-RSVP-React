// Vite's `?raw` suffix imports a file as its text. Tests use it to read a migration or a fixture in EVERY test
// environment — `node:fs` cannot be loaded under jsdom, which made two suites fail to load in the nightly QA run.
declare module '*?raw' {
  const content: string;
  export default content;
}
