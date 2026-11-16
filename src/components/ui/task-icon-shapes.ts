/** Original QuanDeck task marks. These are task identities, never execution-status icons. */
export type TaskShapePart = { d: string; stroke?: number; transform?: string };
export type TaskShape = { id: string; name: string; parts: readonly TaskShapePart[] };
const c = (x: number, y: number, r: number) => `M ${x-r} ${y} a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 ${-r*2} 0 Z`;
const poly = (points: number[][]) => points.map(([x,y], i) => `${i ? 'L' : 'M'} ${x.toFixed(3)} ${y.toFixed(3)}`).join(' ') + ' Z';
const regular = (count: number, radius: number, phase = -Math.PI/2) => poly(Array.from({length:count}, (_,i) => [12 + radius*Math.cos(phase+i*Math.PI*2/count), 12+radius*Math.sin(phase+i*Math.PI*2/count)]));
const star = (count: number, outer: number, inner: number) => poly(Array.from({length:count*2}, (_,i) => {const a=-Math.PI/2+i*Math.PI/count, r=i%2?inner:outer;return [12+r*Math.cos(a),12+r*Math.sin(a)];}));
const f = (d: string, transform?: string): TaskShapePart => ({d, ...(transform ? {transform} : {})});
const s = (d: string, stroke=1.8, transform?: string): TaskShapePart => ({d,stroke,...(transform?{transform}:{})});
const petals = (count: number, d: string) => Array.from({length:count},(_,i)=>f(d,`rotate(${i*360/count} 12 12)`));
const mark = (id: string, name: string, ...parts: TaskShapePart[]): TaskShape => ({id,name,parts});

/** The first 100 entries are stable persisted indexes. Never reorder this catalogue. */
export const TASK_ICON_SHAPES: readonly TaskShape[] = [
  // 01–10 · Orbit — disks, cuts and orbital motion.
  mark('aperture','旋环',...petals(6,'M 12 2 C 17 2 20 5 19 10 L 15 10 C 16 7 14 6 12 6 Z')),
  mark('saturn','行星',f(c(12,12,5.5)),s('M 4 9 C -2 14 9 19 18 15 C 26 11 20 6 17 8',1.8)),
  mark('bullseye','同心',f(c(12,12,9)+c(12,12,6.4)+c(12,12,3))),
  mark('diamond-orbit','菱轨',s('M 12 2 L 22 12 L 12 22 L 2 12 Z',2),f(c(12,12,3.6))),
  mark('binary','双星',f(c(7,8,4.5)+c(17,16,4.5)),s('M 10 5 C 21 1 25 17 15 20',1.8)),
  mark('crescent','月牙',f('M 17 3 A 9.5 9.5 0 1 0 21 16 A 8.4 8.4 0 0 1 17 3 Z')),
  mark('ellipses','交轨',s('M 12 2 C 5 2 5 22 12 22 C 19 22 19 2 12 2 Z',1.8),s('M 2 12 C 2 5 22 5 22 12 C 22 19 2 19 2 12 Z',1.8)),
  mark('constellation','星群',f(c(5,6,2.6)+c(18,4,2.1)+c(13,14,3.4)+c(4,20,2)+c(21,20,2.1))),
  mark('orbital-cross','四极',f('M 10 2 H 14 V 8 H 20 V 12 H 14 V 18 H 10 V 12 H 4 V 8 H 10 Z'),f(c(12,21,1.5))),
  mark('split-ring','断环',f('M 11 2 A 10 10 0 0 0 2 11 H 6 A 6 6 0 0 1 11 6 Z M 13 2 V 6 A 6 6 0 0 1 18 11 H 22 A 10 10 0 0 0 13 2 Z M 2 13 A 10 10 0 0 0 11 22 V 18 A 6 6 0 0 1 6 13 Z M 13 22 A 10 10 0 0 0 22 13 H 18 A 6 6 0 0 1 13 18 Z')),
  // 11–20 · Facet — bold facets and clear negative space.
  mark('diamond','菱晶',f('M 12 2 L 22 12 L 12 22 L 2 12 Z')),
  mark('cube','方晶',f('M 12 2 L 22 7 V 17 L 12 22 L 2 17 V 7 Z M 12 5 L 6 8 L 12 11 L 18 8 Z M 4 10 V 16 L 11 19.5 V 13.5 Z M 13 13.5 V 19.5 L 20 16 V 10 Z')),
  mark('hexagon','六边',f(regular(6,10,0))),
  mark('hourglass','沙漏',f('M 4 3 H 20 L 15 11 V 13 L 20 21 H 4 L 9 13 V 11 Z M 8 6 L 12 11 L 16 6 Z')),
  mark('triad','三角组',f('M 12 2 L 16.5 10 H 7.5 Z M 6.5 11.5 L 11 20 H 2 Z M 17.5 11.5 L 22 20 H 13 Z')),
  mark('pyramid','金字塔',f('M 12 2 L 22 21 H 2 Z M 12 8 L 6.5 18 H 12 Z')),
  mark('octagon','八方',f(regular(8,10,Math.PI/8))),
  mark('hex-window','六角窗',f(regular(6,10,0)+regular(6,5,0))),
  mark('fold','折面',f('M 2 5 L 12 2 L 22 5 V 18 L 12 22 L 2 18 Z M 12 5 V 19 L 19 16.5 V 7 Z')),
  mark('pentagon','五边',f(regular(5,10))),
  // 21–30 · Flora — organic outlines with geometric construction.
  mark('four-petals','四瓣',f('M 12 9 C 2 -1 -1 12 9 12 C -1 22 12 25 12 15 C 22 25 25 12 15 12 C 25 2 12 -1 12 9 Z')),
  mark('five-petals','五瓣',...petals(5,'M 10 10 C 4 -1 20 -1 14 10 Z'),f(c(12,12,3))),
  mark('six-petals','六瓣',...petals(6,'M 10.7 9 C 7 0 17 0 13.3 9 Z'),f(c(12,12,2.3))),
  mark('leaf','叶片',f('M 3 20 C 1 8 8 2 21 3 C 22 16 16 23 5 21 L 16 9 L 3 20 Z')),
  mark('sprout','新芽',f('M 11 22 V 14 C 3 15 1 8 2 4 C 10 3 13 8 12 12 C 11 4 17 1 22 2 C 23 9 20 14 14 14 V 22 Z')),
  mark('clover','三叶',f(c(12,7,5)+c(6.8,13,5)+c(17.2,13,5)+' M 11 15 H 14 L 17 22 H 13 Z')),
  mark('seed','种子',f('M 12 2 C 0 11 2 22 12 22 C 22 22 24 11 12 2 Z M 12 7 C 7 12 7 17 12 19 Z')),
  mark('lotus','莲瓣',f('M 12 2 C 5 8 9 15 12 19 C 15 15 19 8 12 2 Z M 3 6 C 1 14 4 20 10 21 C 6 16 5 11 3 6 Z M 21 6 C 23 14 20 20 14 21 C 18 16 19 11 21 6 Z')),
  mark('rosette','花轮',...petals(8,'M 10.8 8 L 10.4 2 L 13.6 2 L 13.2 8 Z'),f(c(12,12,4))),
  mark('branch','枝序',s('M 12 22 V 4 M 12 11 L 5 5 M 12 17 L 19 11',2.4),f('M 3 3 C 8 2 11 6 10 9 C 6 10 3 7 3 3 Z M 21 9 C 22 14 18 17 15 16 C 14 12 17 9 21 9 Z')),
  // 31–40 · Motion — directional shapes without status semantics.
  mark('lightning','闪电',f('M 13 1 L 3 14 H 10 L 8 23 L 21 9 H 13 Z')),
  mark('wave','波浪',f('M 2 10 C 5 4 8 4 12 10 C 16 16 19 16 22 10 V 16 C 19 22 16 22 12 16 C 8 10 5 10 2 16 Z')),
  mark('wind','风线',s('M 2 8 H 14 C 21 8 21 1 17 3 M 2 12 H 21 M 2 16 H 11 C 18 16 18 23 14 21',2.4)),
  mark('comet','彗星',f(c(16,16,6)+' M 12 10 L 3 2 L 7 13 Z M 10 15 L 2 10 L 5 18 Z M 15 10 L 10 2 L 18 5 Z')),
  mark('arrowhead','箭羽',f('M 3 3 L 22 12 L 3 21 L 7 12 Z M 9 12 L 4 9 L 4 15 Z')),
  mark('chevrons','双折',f('M 3 3 L 12 12 L 3 21 L 0.5 18.5 L 7 12 L 0.5 5.5 Z M 14 3 L 23 12 L 14 21 L 11.5 18.5 L 18 12 L 11.5 5.5 Z')),
  mark('turbine','三旋',...petals(3,'M 11 11 C 4 5 9 0 14 2 C 19 4 16 9 13 12 Z'),f(c(12,12,2.3))),
  mark('pinwheel','风车',f('M 12 12 V 2 H 21 Z M 12 12 H 22 V 21 Z M 12 12 V 22 H 3 Z M 12 12 H 2 V 3 Z')),
  mark('ribbon','绸带',f('M 2 3 H 8 L 14 17 H 22 V 21 H 10 L 4 7 H 2 Z M 10 3 H 16 L 22 17 H 16 Z')),
  mark('twist','回旋',s('M 3 4 C 23 4 1 20 21 20 M 3 20 C 23 20 1 4 21 4',3)),
  // 41–50 · Structure — architecture and orderly construction.
  mark('arch','拱门',f('M 2 22 V 12 A 10 10 0 0 1 22 12 V 22 H 16 V 12 A 4 4 0 0 0 8 12 V 22 Z')),
  mark('bridge','桥',f('M 2 7 H 22 V 11 H 20 V 22 H 17 V 11 H 14 V 22 H 10 V 11 H 7 V 22 H 4 V 11 H 2 Z M 5 2 H 19 V 5 H 5 Z')),
  mark('window','四窗',f('M 3 3 H 11 V 11 H 3 Z M 13 3 H 21 V 11 H 13 Z M 3 13 H 11 V 21 H 3 Z M 13 13 H 21 V 21 H 13 Z')),
  mark('grid','九格',...Array.from({length:9},(_,i)=>f(`M ${2+(i%3)*7} ${2+Math.floor(i/3)*7} h 5 v 5 h -5 Z`))),
  mark('stairs','阶梯',f('M 2 16 H 8 V 9 H 15 V 2 H 22 V 22 H 2 Z')),
  mark('maze','迷宫',s('M 3 21 V 3 H 21 V 21 H 9 V 9 H 15 V 15',2.8)),
  mark('bricks','层砖',f('M 2 3 H 10 V 8 H 2 Z M 12 3 H 22 V 8 H 12 Z M 2 10 H 16 V 15 H 2 Z M 18 10 H 22 V 15 H 18 Z M 2 17 H 7 V 22 H 2 Z M 9 17 H 22 V 22 H 9 Z')),
  mark('portal','门廊',f('M 3 2 H 21 V 22 H 3 Z M 7 6 V 18 H 17 V 6 Z M 10 9 H 14 V 22 H 10 Z')),
  mark('columns','立柱',f('M 2 2 H 22 V 5 H 2 Z M 3 7 H 7 V 18 H 3 Z M 10 7 H 14 V 18 H 10 Z M 17 7 H 21 V 18 H 17 Z M 2 20 H 22 V 23 H 2 Z')),
  mark('corners','四隅',f('M 2 2 H 10 V 5 H 5 V 10 H 2 Z M 14 2 H 22 V 10 H 19 V 5 H 14 Z M 2 14 H 5 V 19 H 10 V 22 H 2 Z M 19 14 H 22 V 22 H 14 V 19 H 19 Z')),
  // 51–60 · Signal — stars, rays and landmarks.
  mark('north-star','四芒',f(star(4,11,3.5))),
  mark('star','五芒',f(star(5,11,5))),
  mark('asterisk','六芒',f(star(6,10.5,4))),
  mark('spark','八芒',f(star(8,11,6))),
  mark('sun','日轮',f(c(12,12,5)),...Array.from({length:8},(_,i)=>s('M 12 1.5 V 4',2,`rotate(${i*45} 12 12)`))),
  mark('rays','光束',...Array.from({length:12},(_,i)=>f('M 11 2 H 13 L 12.5 8 H 11.5 Z',`rotate(${i*30} 12 12)`))),
  mark('beacon','灯塔',f('M 10 8 H 14 L 18 22 H 6 Z M 8 5 L 12 1 L 16 5 V 7 H 8 Z'),s('M 1 5 H 5 M 19 5 H 23 M 4 0 L 6 2 M 18 2 L 20 0',1.8)),
  mark('crown','王冠',f('M 2 5 L 7 10 L 12 2 L 17 10 L 22 5 L 19 18 H 5 Z M 5 20 H 19 V 23 H 5 Z')),
  mark('flag','旗帜',f('M 3 2 H 6 V 22 H 3 Z M 8 3 H 22 L 17 8 L 22 13 H 8 Z')),
  mark('prism-beam','棱光',f('M 9 2 L 20 21 H 1 Z M 9 8 L 5 17 H 13 Z'),s('M 13 6 L 22 2 M 15 10 H 23 M 18 14 L 23 18',1.8)),
  // 61–70 · Objects — memorable tangible forms.
  mark('bookmark','书签',f('M 5 2 H 19 V 22 L 12 17 L 5 22 Z')),
  mark('book','书页',f('M 2 3 C 6 2 9 3 11 5 V 22 C 8 19 5 19 2 20 Z M 13 5 C 15 3 18 2 22 3 V 20 C 19 19 16 19 13 22 Z')),
  mark('pencil','铅笔',f('M 2 22 L 4 15 L 16 3 L 21 8 L 9 20 Z M 18 1 L 23 6 L 22 7 L 17 2 Z M 5 16 L 4 20 L 8 19 Z')),
  mark('ink','墨瓶',f('M 8 2 H 16 V 5 H 8 Z M 7 7 H 17 L 21 12 V 22 H 3 V 12 Z M 8 13 V 19 H 16 V 13 Z')),
  mark('gem','宝石',f('M 5 3 H 19 L 23 9 L 12 22 L 1 9 Z M 5 6 L 4 8 H 9 L 10 6 Z M 14 6 L 15 8 H 20 L 19 6 Z M 10 10 L 12 17 L 14 10 Z')),
  mark('compass','罗盘',s(c(12,12,9.5),1.8),f('M 16.5 6.5 L 14 14 L 6.5 16.5 L 10 10 Z')),
  mark('shield','盾徽',f('M 12 1 L 22 5 V 12 C 21 18 16 22 12 24 C 8 22 3 18 2 12 V 5 Z M 12 5 L 6 7 V 12 C 7 16 10 18 12 19 Z')),
  mark('lock','锁',f('M 5 10 V 8 A 7 7 0 0 1 19 8 V 10 H 21 V 22 H 3 V 10 Z M 8 10 H 16 V 8 A 4 4 0 0 0 8 8 Z M 11 14 V 19 H 13 V 14 Z')),
  mark('key','钥匙',f(c(8,8,6)+c(8,8,2.5)+' M 12 10 L 22 20 L 19 23 L 16 20 L 18 18 L 16 16 L 14 18 L 9 13 Z')),
  mark('woven','编结',s('M 7 3 L 21 17 L 17 21 L 3 7 Z M 17 3 L 21 7 L 7 21 L 3 17 Z',2.3)),
  // 71–80 · Terrain — landscape and elemental forms.
  mark('mountain','山岳',f('M 12 2 L 24 22 H 0 Z M 12 8 L 8 15 L 12 13 L 16 15 Z')),
  mark('peaks','双峰',f('M 1 21 L 8 6 L 15 21 Z M 10 13 L 16 2 L 24 21 H 17 Z')),
  mark('volcano','火山',f('M 8 8 H 16 L 23 22 H 1 Z M 11 10 L 8 19 H 11 L 13 14 Z'),s('M 10 5 L 8 2 M 14 5 L 16 2 M 12 4 V 1',1.8)),
  mark('drop','水滴',f('M 12 1 C 10 6 3 11 3 16 A 9 7 0 0 0 21 16 C 21 11 14 6 12 1 Z M 7 13 C 4 18 9 21 11 19 C 8 19 6 16 7 13 Z')),
  mark('flame','火苗',f('M 13 1 C 14 9 5 8 8 15 C 9 17 11 15 12 12 C 15 14 18 11 17 6 C 27 17 18 24 12 23 C 0 23 -1 13 6 7 C 5 11 7 11 8 8 C 10 6 12 4 13 1 Z')),
  mark('cloud','云朵',f('M 6 20 A 5 5 0 0 1 5 10 A 7 7 0 0 1 18 9 A 5.5 5.5 0 0 1 19 20 Z')),
  mark('rainbow','虹桥',s('M 2 21 V 13 A 10 10 0 0 1 22 13 V 21 M 6 21 V 13 A 6 6 0 0 1 18 13 V 21 M 10 21 V 13 A 2 2 0 0 1 14 13 V 21',2)),
  mark('island','岛屿',f('M 2 20 Q 12 14 22 20 V 23 H 2 Z M 11 18 V 7 H 14 V 18 Z M 12 7 C 5 0 2 4 2 8 C 6 7 8 7 12 9 C 16 7 19 7 22 8 C 21 2 17 0 12 7 Z')),
  mark('river','河流',f('M 8 2 H 15 C 3 9 25 13 16 22 H 8 C 22 13 -1 9 8 2 Z')),
  mark('ice','冰晶',s('M 12 1 V 23 M 2.5 6.5 L 21.5 17.5 M 2.5 17.5 L 21.5 6.5 M 8 3 L 12 7 L 16 3 M 8 21 L 12 17 L 16 21 M 2 11 L 7 9 L 6 4 M 22 13 L 17 15 L 18 20 M 6 20 L 7 15 L 2 13 M 18 4 L 17 9 L 22 11',1.6)),
  // 81–90 · Systems — networks, joins and mechanisms.
  mark('three-nodes','三点',s('M 12 4 L 4 19 H 20 Z',2),f(c(12,4,3)+c(4,19,3)+c(20,19,3))),
  mark('four-nodes','四点',s('M 5 5 L 19 19 M 19 5 L 5 19',2),f(c(5,5,3.5)+c(19,5,3.5)+c(5,19,3.5)+c(19,19,3.5))),
  mark('mesh','网格',s('M 12 2 L 22 8 V 18 L 12 23 L 2 18 V 8 Z M 2 8 L 22 18 M 22 8 L 2 18 M 12 2 V 23',1.8)),
  mark('merge','汇聚',s('M 3 3 V 8 C 3 13 12 9 12 15 V 22 M 21 3 V 8 C 21 13 12 9 12 15',3),f(c(3,3,2)+c(21,3,2)+c(12,21,2))),
  mark('fork','分支',s('M 5 2 V 22 M 5 14 C 18 14 19 10 19 3',3),f(c(5,3,2.5)+c(5,21,2.5)+c(19,3,2.5))),
  mark('puzzle','拼片',f('M 3 3 H 9 C 7 -1 17 -1 15 3 H 21 V 9 C 17 7 17 17 21 15 V 21 H 15 C 17 17 7 17 9 21 H 3 V 15 C -1 17 -1 7 3 9 Z')),
  mark('gear-six','六齿',f(star(6,11,8)+c(12,12,4))),
  mark('gear-eight','八齿',f(star(8,11,8.5)+c(12,12,4.5))),
  mark('chain','链环',s('M 13 7 C 6 -3 -2 11 7 14 M 11 17 C 18 27 26 13 17 10 M 8 16 L 16 8',3)),
  mark('three-links','三环',s(c(12,6,4.5)+c(6,16,4.5)+c(18,16,4.5),2.4)),
  // 91–100 · Abstract — expressive marks with distinct silhouettes.
  mark('heart','心形',f('M 12 22 C 8 19 1 13 1 7 C 1 0 9 0 12 6 C 15 0 23 0 23 7 C 23 13 16 19 12 22 Z')),
  mark('infinity','无限',s('M 12 12 C 7 2 1 5 1 12 C 1 19 7 22 12 12 C 17 2 23 5 23 12 C 23 19 17 22 12 12 Z',3)),
  mark('balance','阴阳',f('M 12 2 A 10 10 0 0 0 12 22 A 5 5 0 0 0 12 12 A 5 5 0 0 1 12 2 Z'+c(12,17,1.5)),s('M 12 2 A 10 10 0 0 1 12 22',1.8),f(c(12,7,1.5))),
  mark('bow','蝶结',f('M 2 4 L 12 10 L 22 4 V 20 L 12 14 L 2 20 Z')),
  mark('fan','折扇',f('M 12 22 L 1 12 C 3 -2 21 -2 23 12 Z M 11 17 L 8 5 L 5 7 Z M 13 17 L 19 7 L 16 5 Z')),
  mark('shell','贝壳',s('M 12 22 C -2 20 -1 2 12 2 C 25 2 26 20 12 22 Z M 12 22 V 3 M 12 22 C 3 16 4 6 7 4 M 12 22 C 21 16 20 6 17 4',2.1)),
  mark('wing','翼',f('M 2 21 V 4 L 22 1 L 17 7 H 7 V 9 H 16 L 13 13 H 7 V 15 H 12 L 8 20 Z')),
  mark('eye','眼',f('M 1 12 Q 12 -2 23 12 Q 12 26 1 12 Z M 5 12 Q 12 3 19 12 Q 12 21 5 12 Z'),f(c(12,12,3.5))),
  mark('layers','叠层',f('M 12 1 L 23 7 L 12 13 L 1 7 Z M 1 11 L 12 17 L 23 11 V 15 L 12 21 L 1 15 Z M 4 19 L 12 23 L 20 19 V 22 L 12 24 L 4 22 Z')),
  mark('brackets','括弧',s('M 8 2 H 5 V 9 L 2 12 L 5 15 V 22 H 8 M 16 2 H 19 V 9 L 22 12 L 19 15 V 22 H 16',2.7)),
];

export const TASK_ICON_BASE_COUNT = TASK_ICON_SHAPES.length;

/** Overflow never cycles back to a bare mark. An 8-position peripheral signature encodes the
 * generation. More than 25,600 identities add another signature band instead of reusing a mark.
 * Shape allocation is persisted by the data layer, independent of palette and task ordering. */
export function taskShape(index: number): TaskShape & { generation: number } {
  const safe = Number.isSafeInteger(index) && index >= 0 ? index : 0;
  return {...TASK_ICON_SHAPES[safe % TASK_ICON_BASE_COUNT], generation: Math.floor(safe / TASK_ICON_BASE_COUNT)};
}
export function taskSignature(generation: number): TaskShapePart[] {
  const result: TaskShapePart[] = [];
  for(let band=0, value=generation; value>0; band++,value=Math.floor(value/256)) {
    const byte=value%256, radius=10.5-band*1.25;
    for(let slot=0;slot<8;slot++) if(byte & (1<<slot)) {
      const angle=-Math.PI/2+slot*Math.PI/4, x=12+radius*Math.cos(angle), y=12+radius*Math.sin(angle);
      result.push(f(`M ${(x-.9).toFixed(3)} ${(y-.9).toFixed(3)} h 1.8 v 1.8 h -1.8 Z`));
    }
  }
  return result;
}
