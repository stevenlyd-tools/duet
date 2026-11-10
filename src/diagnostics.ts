import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
export function diagnostics(project:string, packageRoot=fileURLToPath(new URL('..',import.meta.url))) {
 const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
 const pkg=read(join(packageRoot,'package.json'));
 const install=join(packageRoot,'.codex-marketplace-install.json');
 const source=existsSync(install)?read(install):null;
 const git=spawnSync('git',['rev-parse','HEAD'],{cwd:packageRoot,encoding:'utf8'});
 const canonical=readFileSync(join(packageRoot,'skills/duet/SKILL.md'),'utf8');
 const plugin=join(packageRoot,'plugin.json');
 const lock=join(packageRoot,'distribution-lock.json');
 const skillHash=createHash('sha256').update(canonical).digest('hex');
 const expectedHash=existsSync(lock)?read(lock).files?.['skills/duet/SKILL.md']:undefined;
 const paths=['AGENTS.md','.duet/skills/duet/SKILL.md','.agents/skills/duet/SKILL.md','.claude/skills/duet/SKILL.md'];
 return {package:pkg.name,cliVersion:pkg.version,pluginVersion:existsSync(plugin)?read(plugin).version:null,skill:{sha256:skillHash,matchesDistribution:expectedHash===undefined?null:expectedHash===skillHash},packageRoot,source,checkoutSha:git.status===0?git.stdout.trim():null,
   nativeUpdates:{supported:'host-native mechanisms; see docs/distribution.md',configured:'unknown; inspect host settings',verified:'not checked; catalog refresh does not prove activation'},
   instructions:paths.filter(p=>existsSync(resolve(project,p))).map(path=>({path,status:path==='AGENTS.md'?'project instructions: review precedence':readFileSync(resolve(project,path),'utf8')===canonical?'matches running package':'different content: reconcile instructions before work'})),
   notice:'Read-only diagnostics. No installation, update, credentials or permissions changed. Verify each collaborator and active session separately.'};
}
