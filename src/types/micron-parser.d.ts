declare module 'micron-parser' {
  export default class MicronParser {
    constructor(darkTheme?: boolean, enableForceMonospace?: boolean);
    convertMicronToFragment(markup: string): DocumentFragment;
    convertMicronToHtml(markup: string): string;
  }
}
