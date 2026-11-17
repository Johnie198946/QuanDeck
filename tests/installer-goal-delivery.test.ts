import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalWorkdeckDataSource } from '../src/data/repository';
import { deriveDeliveryMap } from '../src/data/goalDelivery';

const memory=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)}});
async function main(){
  // Run the exact shipped smoke scenario before packaging, with real domain commands.
  const moduleUrl=pathToFileURL(path.join(process.cwd(),'desktop/app/smoke-goal-delivery.mjs')).href;
  const {checkGoalDeliveryData}=await new Function('url','return import(url)')(moduleUrl);
  const source=new LocalWorkdeckDataSource();
  const store={read:(key:string)=>JSON.parse(memory.get(key)!)};
  const report=await checkGoalDeliveryData(source,store);
  assert.equal(report.result.strictContract,true);
  const map=deriveDeliveryMap(await source.load(),{planId:report.planId});
  assert.equal(map.total,3);assert.equal(map.filled,2);assert.equal(map.accepted,0);
  const restarted=new LocalWorkdeckDataSource();
  assert.deepEqual(JSON.parse(JSON.stringify(deriveDeliveryMap(await restarted.load(),{planId:report.planId}))),JSON.parse(JSON.stringify(map)),'installer fixture persists real state across repository restart');
  console.log('Installer strict goal-delivery smoke fixture and persisted final map passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
