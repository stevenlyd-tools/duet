import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

type Command = {argv:string[]; timeoutMs?:number};
type Context = {cwd:string; manifest:unknown; config:{hooks?:Record<string,unknown>}};
const safeNames = /^[A-Z][A-Z0-9_]*$/;
const reserved = /^(?:DUET_.*|HOME|TMPDIR|TMP|TEMP|PATH|CI)$/;
const forbidden = /(?:PROD|PRODUCTION|AWS|AZURE|GOOGLE_APPLICATION_CREDENTIALS|GITHUB_TOKEN|GH_TOKEN|SSH_AUTH_SOCK|NODE_OPTIONS|LD_PRELOAD|DYLD)/i;
export function makeHooks(_root:string, approved:boolean) {
  function execute(ctx:Context, commands:Command[]) {
    if (!approved) throw new Error('HOOK_APPROVAL_REQUIRED: Review project hooks, then explicitly pass --approve-hooks. Host permission policy still applies.');
    if (!Array.isArray(commands) || commands.length===0) throw new Error('CHECKS_REQUIRED: Configure at least one basic check.');
    const hooks=ctx.config.hooks??{};
    const allow=hooks.envAllow??[];
    if (!Array.isArray(allow) || allow.some(n=>typeof n!=='string'||!safeNames.test(n)||forbidden.test(n)||reserved.test(n))) throw new Error('UNSAFE_ENV: envAllow contains forbidden or invalid names.');
    const home=mkdtempSync(join(tmpdir(),'duet-hook-home-'));
    const env:Record<string,string>={PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,TMPDIR:home,CI:'true',DUET_ENVIRONMENT:'alpha'};
    for(const n of allow as string[]) if(process.env[n]!==undefined) env[n]=process.env[n]!;
    const results=[];
    try {
      for(const command of commands) {
        if (!command || !Array.isArray(command.argv) || !command.argv.length || command.argv.some(v=>typeof v!=='string'||v.includes('\0')) || !Number.isSafeInteger(command.timeoutMs??120000) || (command.timeoutMs??120000)<1 || (command.timeoutMs??120000)>900000) throw new Error('INVALID_HOOK: use argv string arrays and timeoutMs 1..900000.');
        const result=spawnSync(command.argv[0],command.argv.slice(1),{cwd:ctx.cwd,env,shell:false,timeout:command.timeoutMs??120000,encoding:'utf8',maxBuffer:1024*1024});
        // Do not persist command output, which can contain accidentally printed secrets.
        results.push({command:command.argv[0],status:result.status,error:result.error?.message});
        if(result.status!==0 || result.error) return {ok:false,details:results};
      }
      return {ok:true,details:results};
    } finally {rmSync(home,{recursive:true,force:true});}
  }
  return {
    runChecks:(ctx:Context)=>execute(ctx,ctx.config.hooks?.checks as Command[]??[])
  };
}
