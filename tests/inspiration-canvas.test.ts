import assert from "node:assert/strict";
import { appendMethodFragment, createMethodBoard, deleteMethodBoard, editableMethodBoard, methodBoards, saveMethodTemplate, switchMethodBoard } from "../src/data/methodBoards";
import {
  connectInspirations,
  describeInspiration,
  emptyInspirationBoard,
  insertInspiration,
  isInspirationBoard,
  removeInspiration,
  reverseInspiration,
} from "../src/data/inspirationCanvas";
import { emptyKnowledge, knowledgeAnchorText, makeSelection, parseKnowledge, type KnowledgeNote } from "../src/data/knowledgeNotes";

const board = emptyInspirationBoard();
insertInspiration(board, "kyoto");
insertInspiration(board, "osaka");
insertInspiration(board, "osaka");
assert.equal(board.nodes.length, 2);
board.nodes[1].x = 460;
const edge = connectInspirations(board, "kyoto", "osaka");
edge.label = "前往";
edge.detail = "到大阪后先去放下行李。";
assert.equal(connectInspirations(board, "kyoto", "osaka").id, edge.id);
assert.equal(board.links.length, 1);
assert.throws(() => connectInspirations(board, "osaka", "osaka"));
assert.throws(() => connectInspirations(board, "kyoto", "unknown"));
reverseInspiration(board, edge.id);
assert.deepEqual([edge.from, edge.to, edge.detail], ["osaka", "kyoto", ""]);
assert.match(describeInspiration("大阪", "京都", edge.label), /大阪.*前往.*京都/);
reverseInspiration(board, edge.id);
assert.equal(edge.detail, "到大阪后先去放下行李。");
connectInspirations(board, "osaka", "kyoto");
assert.throws(() => reverseInspiration(board, edge.id));
const library = { ...emptyKnowledge(), inspirationCanvas: board };
assert.deepEqual(parseKnowledge(JSON.stringify(library)).inspirationCanvas, board);
assert.equal(parseKnowledge(JSON.stringify(emptyKnowledge())).inspirationCanvas, undefined);
assert.ok(!isInspirationBoard({ nodes: [], links: board.links }));
removeInspiration(board, "osaka");
assert.deepEqual(board.links, []);
assert.deepEqual(
  board.nodes.map((node) => node.noteId),
  ["kyoto"],
);
const ideas = emptyInspirationBoard();
const source = { noteId: "source", revision: 1, field: "body" as const, start: 0, end: 6, digest: "a".repeat(64) };
insertInspiration(ideas, "idea-1", {title:"预留换乘时间",detail:"",origin:"extracted",source});
insertInspiration(ideas, "idea-2", {title:"超时则换路线",detail:"",origin:"extracted",source});
insertInspiration(ideas, "mine", {title:"比较两种走法",detail:"预算内",origin:"manual"});
insertInspiration(ideas, "link", {title:"时刻表",detail:"",origin:"reference",reference:{url:"https://example.org/timetable"}});
insertInspiration(ideas, "file", {title:"地图",detail:"",origin:"reference",reference:{file:{id:"map",name:"map.png",type:"image/png",size:28}}});
assert.equal(ideas.nodes.length,5);
assert.throws(() => insertInspiration(ideas, "bad", {title:"无效",detail:"",origin:"reference",reference:{url:"javascript:void(0)"}}));
connectInspirations(ideas, "idea-1", "idea-2");
const saved = parseKnowledge(JSON.stringify({...emptyKnowledge(),inspirationCanvas:ideas}));
assert.deepEqual(saved.inspirationCanvas,ideas);

const date = "2026-11-01T00:00:00Z";
const anchorNote: KnowledgeNote = {
  id: "n", title: "出行", body: "线路", revision: 1, createdAt: date, updatedAt: date,
  attachments: [], history: [],
  expansions: [{id: "q", at: date, selection: makeSelection("线路", 0, 2),
    question: "改走哪条线路", background: "希望少换乘", answer: "试试东线", sourceIds: []}],
};
for(const [field,original] of [["question","改走哪条线路"],["background","希望少换乘"],["expansion","试试东线"]]) {
  assert.equal(knowledgeAnchorText(anchorNote,{noteId:"n",revision:1,source:field+":q",start:1,end:3,origin:"测试"}),original.slice(1,3));
}

// A long-running import or summary may finish after a different board is opened.
const shelf = emptyKnowledge();
const firstBoard = createMethodBoard(shelf, "整理方法");
assert.equal(methodBoards(shelf).length, 1);
appendMethodFragment(editableMethodBoard(shelf, firstBoard), ideas);
const originalView = JSON.stringify(editableMethodBoard(shelf, firstBoard));
const template = saveMethodTemplate(shelf, firstBoard, "出行", "选择路线", originalView);
const secondBoard = createMethodBoard(shelf, "另一趟旅行", template);
removeInspiration(editableMethodBoard(shelf, firstBoard), "idea-2");
assert.equal(editableMethodBoard(shelf, secondBoard).nodes.length, 5);
assert.equal(shelf.methodTemplates![0].board.nodes.length, 5);
assert.throws(() => saveMethodTemplate(shelf, firstBoard, "过时的总结", "", originalView), /更新/);
switchMethodBoard(shelf, firstBoard);
deleteMethodBoard(shelf, firstBoard);
assert.throws(() => editableMethodBoard(shelf, firstBoard), /删除/);
deleteMethodBoard(shelf, secondBoard);
assert.deepEqual(methodBoards(parseKnowledge(JSON.stringify(shelf))), []);
assert.throws(() => createMethodBoard(shelf, "冒名模板", "missing"), /删除/);
assert.throws(() => parseKnowledge(JSON.stringify({...shelf, inspirationBoards:{active:null,others:[{}]}})), /画布/);
assert.throws(() => parseKnowledge(JSON.stringify({...shelf, methodTemplates:[{id:"broken"}]})), /模板/);
