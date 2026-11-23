import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import ts from "typescript";
import {describe,expect,it} from "vitest";
import en from "./en";
import de from "./de";
import ba from "./ba";
import fr from "./fr";
import es from "./es";
const catalogues={en,de,ba,fr,es};
const variables=(text:string)=>[...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].map(match=>match[1]).sort();
describe("translation catalogue contract",()=>{
 for(const [language,catalogue] of Object.entries(catalogues)){
  it(`${language} supplies every key and preserves interpolation variables`,()=>{
   expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort());
   for(const [key,source] of Object.entries(en)){
    expect(catalogue[key]?.trim(),`${language}: ${key}`).toBeTruthy();
    expect(variables(catalogue[key]),`${language}: ${key}`).toEqual(variables(source));
    expect(catalogue[key],`${language}: leaked XML escape in ${key}`).not.toMatch(/&(?:apos|quot|amp);/);
   }
  });
 }
 for(const language of ["de","ba","fr","es"] as const){
  it(`${language} translates core actions instead of retaining English placeholders`,()=>{
   for(const key of ["fontEditor.saved","fontEditor.undo","fontEditor.redo","interface.rulers","workspace.paint","printers.test","settings.mcp.copyToken"]){
    expect(catalogues[language][key],`${language}: ${key}`).not.toBe(en[key]);
   }
  });
 }
 it("defines all literal translation keys used by the interface",()=>{
  const root=fileURLToPath(new URL("../",import.meta.url));const missing:string[]=[];
  function scan(directory:string){for(const item of readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,item.name);
   if(item.isDirectory())scan(file);
   else if(/\.tsx?$/.test(file)&&!file.includes(".test.")){
    const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function visit(node:ts.Node){
     if(ts.isCallExpression(node)&&node.expression.getText(source)==="t"&&node.arguments.length){
      const key=node.arguments[0];if((ts.isStringLiteral(key)||ts.isNoSubstitutionTemplateLiteral(key))&&!(key.text in en))missing.push(`${path.relative(root,file)}: ${key.text}`);
     }
     ts.forEachChild(node,visit);
    }
    visit(source);
   }
  }}
  scan(root);expect(missing).toEqual([]);
 });
});
