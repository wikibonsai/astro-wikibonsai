import type { Processor } from 'unified';
import path from 'path';
import fs from 'fs';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { selectAll } from 'unist-util-select';
import * as wikirefs from 'wikirefs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';


const CONTENT_GLOB: string = './src/content/**/*.md';

let globalProcessor: Processor;
let cycleStack: string[] = [];

export function createResolveEmbedContent(remarkPlugins: any[]) {
  console.log("createResolveEmbedContent", remarkPlugins);
  if (!globalProcessor) {
    globalProcessor = unified().use(remarkParse);
    // apply same remark plugins as in astro config
    remarkPlugins.forEach(plugin => {
      if (Array.isArray(plugin)) {
        globalProcessor.use(plugin[0], plugin[1]);
      } else {
        globalProcessor.use(plugin);
      }
    });
    // note: we're not using remarkRehype or rehypeStringify here
  }

  return function resolveEmbedContentInternal(filename: string): any {
    // markdown-only
    if (wikirefs.isMedia(filename)) { return; }
    // cycle detection
    if (cycleStack.length === 0) {
      cycleStack = [];
    } else if (cycleStack.includes(filename)) {
      // reset stack before leaving
      cycleStack = [];
      return 'cycle detected';
    }
    cycleStack.push(filename);
    const docPaths: string[] = fg.sync(CONTENT_GLOB);
    const docPath: string | undefined = docPaths.find((p) => {
      return path.basename(p, '.md') === filename;
    });
    let content: string = '';
    if (docPath === undefined) {
      content = 'Error: Content not found for ' + "'" + filename + "'";
    } else {
      const text: string | undefined = fs.readFileSync(docPath, { encoding: 'utf8', flag: 'r' });
      content = matter(text).content;
    }
    let mdastContent: any;
    if (content.length === 0) {
      mdastContent = '';
    } else {
      mdastContent = globalProcessor.parse(content);
    }
    // reset stack before leaving
    cycleStack = [];
    return mdastContent;
  };
}

export function resolveHtmlHref(fname: string): string | undefined {
  // #todo revisit: https://docs.astro.build/en/reference/api-reference/#importmeta
  // 'import.meta.glob' docs:
  //   - astro docs: https://docs.astro.build/en/reference/api-reference/
  //   - vite docs: https://vitejs.dev/guide/features.html#glob-import
  // see:
  //  - https://github.com/withastro/astro/issues/5265
  //  - https://github.com/withastro/docs/pull/1967
  // const posts = import.meta.glob(CONTENT_GLOB, { as: 'raw', eager: true });
  if (!wikirefs.isMedia(fname)) {
    const docPaths: string[] = fg.sync(CONTENT_GLOB);
    const docPath: string | undefined = docPaths.find((p) => {
      return path.basename(p, '.md') === fname;
    });
    if (docPath === undefined) {
      return undefined;
    } else {
      // todo: support dynamic routes (https://docs.astro.build/en/core-concepts/routing/#dynamic-routes)
      return docPath.replace('./src/content', '').replace('.md', '');
    }
  // media
  } else {
    return '/' + fname;
    // note: in case media is stored in separate locations,
    //       uncomment and customize the following:
    // audio
    // if (wikirefs.CONST.EXTS.AUD.has(path.extname(fname))) {
    //   return '/' + fname;
    // }
    // images
    // if (wikirefs.CONST.EXTS.IMG.has(path.extname(fname))) {
    //   return '/' + fname;
    // }
    // video
    // if (wikirefs.CONST.EXTS.VID.has(path.extname(fname))) {
    //   return '/' + fname;
    // }
  }
}

export function resolveHtmlText(fname: string): string | undefined {
  const docPaths: string[] = fg.sync(CONTENT_GLOB);
  const docPath: string | undefined = docPaths.find((p) => {
    return path.basename(p, '.md') === fname;
  });
  if (docPath === undefined) {
    return undefined;
  } else {
    const content: string | undefined = fs.readFileSync(docPath, { encoding: 'utf8', flag: 'r' });
    const data: any = matter(content).data;
    if (!data || !data.title) {
      return undefined;
    } else {
      return data.title.toLowerCase();
    }
  }
}

export function generateForeRefsRemarkPlugin() {
  return function (tree: any, file: any) {
    // from: https://observablehq.com/@tmcw/extracting-links-from-markdown-using-remark-and-unist-util
    // access the first item of the wikiattrs matches since they should already be consolidated in the attrbox data already
    const attrs = selectAll("attrbox", tree).map((node: any) => node.data.items)[0];
    const wikiattrs = {} as any;
    // strip out primitive caml attrs
    if (attrs) {
      for (const [type, vals] of Object.entries(attrs)) {
        // @ts-expect-error
        for (const val of vals) {
          if (val.type === 'wiki') {
            if (!Object.keys(wikiattrs).includes(type)) {
              wikiattrs[type] = [];
            }
            wikiattrs[type].push(val);
          }
        }
      }
    }
    const wikilinks = selectAll("wikilink", tree).map((node: any) => node.data.item);
    const thisFname: string = path.basename(file.history[0], '.md');
    // refs
    file.data.astro.frontmatter.fname = thisFname;
    file.data.astro.frontmatter.foreattrs = wikiattrs;
    file.data.astro.frontmatter.forelinks = wikilinks;
  }
}
