import { join } from 'node:path';
import { createTestFixtureRoot } from '../../../scripts/test-helpers/fixture-root.ts';
import { buildSkillsetResult } from '../../../packages/core/src/build.ts';
const rows=[];
for (const targets of [['claude'],['claude','codex']]) {
 const root=await createTestFixtureRoot('set492-listing-probe-');
 const files:Record<string,string>={
  'skillset.yaml':`skillset:\n  name: probe\ncompile:\n  targets: [${targets.join(', ')}]\n`,
  '.skillset/plugins/demo/skillset.yaml':`skillset:\n  name: demo\n  description: Demo.\n  listing:\n    display_name: Demo Display\n    screenshots: [./assets/shot.png]\n    capabilities: [Read, Write]\n    privacy_policy_url: https://example.invalid/privacy\n    terms_of_service_url: https://example.invalid/terms\n    color: '#112233'\n    composer_icon: ./assets/composer.svg\n    default_prompt: [Help with this project]\n`,
  '.skillset/plugins/demo/assets/shot.png':'shot',
  '.skillset/plugins/demo/assets/composer.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  '.skillset/plugins/demo/skills/helper/SKILL.md':'---\nname: helper\ndescription: Help.\n---\n\nHelp.\n'
 };
 for(const [path,content] of Object.entries(files)) await Bun.write(join(root,path),content);
 try {
  const build=await buildSkillsetResult(root);
  const manifests=Object.fromEntries(build.data.filter(f=>/plugins\/demo\/(?:plugin\.json|\.claude-plugin\/plugin\.json|\.codex-plugin\/plugin\.json)$/.test(f.path)).map(f=>[f.path,JSON.parse(new TextDecoder().decode(f.content))]));
  rows.push({targets,ok:build.ok,allDiagnostics:build.renderResults.flatMap(r=>r.diagnostics??[]),manifests,results:build.renderResults.filter(r=>r.sourceUnit==='plugin.demo.config:root'||r.featureId==='plugin-manifests').map(({sourceUnit,target,standardProfile,featureId,status,policy,diagnostics,reason,outputs})=>({sourceUnit,target,standardProfile,featureId,status,policy,diagnostics,reason,outputs}))});
 } catch(e) {rows.push({targets,error:e instanceof Error?e.message:String(e),renderResults:(e as any)?.renderResults});}
}
console.log(JSON.stringify(rows,null,2));
