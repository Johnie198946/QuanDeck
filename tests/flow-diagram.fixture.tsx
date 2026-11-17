import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { DiscussionCanvas } from '../src/components/discussion/DiscussionCanvas';
import { FlowDiagram } from '../src/components/discussion/FlowDiagram';
import { readDiscussionVisualBlocks } from '../src/data/discussionVisual';
import { readFlowDiagram } from '../src/data/flowDiagram';
import './flow-diagram.fixture.css';
const flow = {version:1,nodes:[{id:'a',label:'接收现有子任务提交的五条规则与一个示例',kind:'start'},{id:'b',label:'是否完整覆盖用户要求',kind:'decision'},{id:'c',label:'未提交部分保持空白并补齐内容'},{id:'d',label:'整合候选规范，保留来源与交接'},{id:'e',label:'人工核对后发布',kind:'end'}],edges:[{from:'a',to:'b'},{from:'b',to:'c',label:'不完整'},{from:'c',to:'b',label:'补齐后再次核对'},{from:'b',to:'d',label:'完整'},{from:'d',to:'e'}]};
const safe = readFlowDiagram(flow);
const hostile = readDiscussionVisualBlocks([{id:'plain',title:'纯文本隔离',kind:'flow',flow:{version:1,nodes:[{id:'safe',label:'<script>window.flowUnsafe=1</script>'}],edges:[]}},{id:'bad',title:'拒绝额外执行指令',kind:'flow',flow:{...flow,execute:true}}]);
function Fixture() {
  const [selected,setSelected]=useState('');
  return <main style={{maxWidth:1000,margin:'auto',padding:16}}><h1>执行方法与台帐流程</h1><FlowDiagram title="执行方法" graph={safe} states={{a:'已验收',b:'执行中',c:'等待条件',d:'可开始',e:'待验收'}} onNode={setSelected}/><p role="status">已选择：{selected}</p><DiscussionCanvas blocks={hostile} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
