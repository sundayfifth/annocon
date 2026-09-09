# งานที่เหลือจาก architecture review

> **baseline เดิม:** `main @ 5c05097` · ตรวจเมื่อ 8 กันยายน 2026 —
> 272 tests / 6 files · coverage `src/core/**` 90.76% stmts · 86.58% branch · 97.5% funcs · 93.97% lines
>
> **สถานะวันนี้:** `sundayfifth/feat-connector-drag-handles @ 696e214` · 9 กันยายน 2026
> `npm run typecheck` · `npm run lint` · `npm test` (**260 tests / 6 files**) · `npm run build` ผ่านทั้งหมด
> **coverage `src/core/**`:** **91.11% stmts · 87.4% branch · 97.45% funcs · 94.44% lines**
> จำนวน test ลดจาก 272 เพราะ B1 ตัด test ที่ไม่ถือ coverage ของตัวเอง 10 ตัว
> และ A2/V1 ลบ test ของ state ที่ไม่มีอยู่แล้วอีก 2 ตัว — coverage ขึ้นทุกตัวเลข
>
> **ปิดแล้วในรอบนี้:** B1 · A4 · A2 · V1 · V2 · T1 T2 T3 T5 T7 (+ A1 A3 จากรอบก่อน)
> **ถัดไป:** B4 (พร้อม T4) · แล้ว B2 → B3 · B5 B7 แทรกได้ · B6 ท้ายสุด

เอกสารนี้แปลง architecture review (rev.2, อ้าง `main @ 471a8fb`) มาเป็นรายการงานที่
**ตรวจซ้ำทุกข้อบน `5c05097` แล้ว** เลข `file:line` ในข้อที่**ยังไม่ปิด** เป็นของ `5c05097`
ไม่ใช่ของรีวิวเดิม — และขยับไปแล้วจากงานที่ปิดในรอบนี้ ยืนยันด้วยคำสั่งในหัวข้อ 8 ก่อนใช้

เครื่องหมายที่ใช้:

| | ความหมาย |
|:--|:--|
| ✅ | ยืนยันแล้วบน `5c05097` — อ่านโค้ดจริง เลขบรรทัดตรง |
| ⚠️ | รีวิวเดิมบอกไว้ **ผิดหรือไม่ครบ** — คำอธิบายที่ถูกอยู่ในข้อนั้น |
| ❌ | รีวิวเดิมบอกว่าเป็นปัญหา แต่**ตรวจแล้วไม่ใช่** — ไม่ต้องทำ |
| 🆕 | ข้อที่เพิ่งเจอตอนตรวจซ้ำ ไม่มีในรีวิวเดิม |

---

## 0. สิ่งที่รีวิวเดิมบอกไว้แล้วไม่ตรงกับ main วันนี้

อ่านส่วนนี้ก่อน ไม่งั้นจะไปทำของที่ทำไปแล้ว

| รีวิวเดิมบอกว่า | ความจริงวันนี้ |
|:--|:--|
| `src/core` 2,652 / `src/scene` 2,932 / 194 tests | **3,142 / 2,638 / 272 tests** — `src/core` โตขึ้น 490 บรรทัด `src/scene` เล็กลง 294 |
| ไม่มี coverage report | มีแล้ว — `npm run coverage`, `@vitest/coverage-v8`, include `src/core/**` (commit `5854ebc`) |
| ADR 0002/0003 ยัง Deferred · ไม่มี ADR 0004 | แก้แล้ว — `docs/adr/0004-search-for-a-route-when-the-rules-run-out.md` มีอยู่ และ Deferred ของ 0002/0003 ถูกปิดแล้ว (`aa121d1`) |
| `resolveAnchor` · `anchorNodeId` · `CATEGORY_VERSION` · `DEFAULT_CATEGORY_COLOR` · `CONNECTOR_DETOURS` ตายอยู่ | ลบ/หด scope แล้วทั้งหมด (`e405c55`) |
| สลับ page แล้ว live re-route ตาย · re-sync ไม่ seed category · stroke minimum ไม่ตรง · reparent teleport ในฝั่ง annotation | แก้แล้วทั้ง 4 ข้อ (`fffc77f`, `3201706`, `22dba90`, `680ff02`) — ✅ ตรวจแล้วว่าทุก reparent site ในฝั่ง annotation เขียนตำแหน่งคืนครบ (`annotationScene.ts:767`→`:786`, `:946`→`:948`) |
| `main.ts:132` ต้อง merge index สองฝั่งกลับเป็นอันเดียว | ✅ **ยังอยู่ ข้อนี้รีวิวเดิมถูก** — `main.ts:131-137` `resolveSelectionOwners` ยัง `new Map(annotationTargetsBehind(nodes))` แล้ว loop `connectorsBehindLabels(nodes)` ใส่ทับ เลขบรรทัดขยับแค่ 1 (ดู B2) |
| stroke weight minimum แก้แล้วใน `22dba90` | ⚠️ **แก้แล้วสองรอบ** — `22dba90` ใส่ `minimum={0.5}` ให้ `TextboxNumeric` ซึ่งทำให้พิมพ์ `0.8` ไม่ได้เลย (ดู "ข้อควรรู้" ใต้ตาราง) `030cde9` เอา prop นั้นออกและเหลือ clamp ตอน blur อย่างเดียว — สถานะปัจจุบันคือถูกแล้ว |
| candidate 1 (ย้าย decision เข้า core) | ทำไปแล้วเกินครึ่ง — เกิด `src/core/obstacleScan.ts` (106) + `src/core/drawnShape.ts` (249) + test 555 บรรทัด จาก 9 commit |
| `connector.ts` มี 3 export ที่ "ไม่มีใครใช้เลย" | ⚠️ **ไม่มีตัวไหนตายสนิท** — ทั้ง 20 ตัวที่ prod ไม่เรียก ถูกใช้ในไฟล์ตัวเองทั้งหมด มันคือ *over-export* ไม่ใช่ dead code คนละงานกัน (ดู B1) |
| "ลบข้อความในป้ายเส้น กับในการ์ด ให้ผลไม่เหมือนกัน" | ❌ **ไม่ใช่ bug** ดูข้อ 3 |
| `ensureOnPage` ตัวที่สองใน `connectorScene` เป็น dead call | ⚠️ วินิจฉัยผิด — มันแย่กว่านั้น **แก้แล้ว** (`d79e5fa`) ดู A4 |

**ข้อควรรู้ที่ได้จาก `030cde9` — สำคัญกับ B5**

`minimum` ของ `TextboxNumeric` **ไม่ใช่ bound ของค่าที่พิมพ์เสร็จ มันเป็น bound ของทุก keystroke**
`RawTextboxNumeric` ประเมินว่าช่องจะเป็นค่าอะไรหลังกดแต่ละปุ่ม แล้วเรียก `preventDefault()`
ถ้าค่านั้นหลุดช่วง — `minimum={0.5}` จึงปฏิเสธเลข `0` ตัวหน้าของ `0.8` ทำให้ทั้งช่วง 0.5–0.9
พิมพ์ไม่ได้ และไม่บอกเหตุผลอะไรเลย

ใครที่ทำ B5 (ดึง `parseStrokeWeight` / `parsePercent` / `parseCornerRadius` เข้า core)
ต้องรู้ข้อนี้ ไม่งั้นจะ "จัดระเบียบ" ด้วยการเอา clamp ไปใส่เป็น `minimum` แล้วทำ bug เดิมกลับมา
ทางที่ถูกคือ clamp ตอน blur — ยอมให้เห็นเลขที่ยังผิดชั่วขณะที่ cursor ยังอยู่ในช่อง

---

## 1. bug ที่ผู้ใช้เจอได้

### A1 ✅ สั่งสองอย่างติดกันแล้วอันหลังทับอันแรก

**หลักฐาน**

- `src/main.ts:314-322` — `handleUpdateConnectorStyle` มี `await figma.getNodeByIdAsync(targetId)` คั่นก่อนเรียกต่อ
- `src/main.ts:746-748` — handler ลงทะเบียนแบบ `fireAndForget(...)` ไม่มีคิว
- `src/scene/connectorScene.ts:1115-1117` — `updateConnectorStyle` อ่าน `getConnectorRecord(node)` แล้วค่อยเขียน `{ ...record, ...changes }`

**อาการ** สอง message ที่มาถึงใน tick เดียวกัน (คลิก swatch ซึ่งปิด flyout พร้อมกับ blur ช่องตัวเลข) จะ
`await` ทั้งคู่ อ่าน record **ก่อนการเปลี่ยน** ทั้งคู่ แล้วเขียนทับกัน — การแก้อันแรกหายไป

**สิ่งที่ต้องทำ** ทำให้ command ที่แก้ record เดียวกันเข้าคิว ทางที่ตรงที่สุดคือ promise chain
ต่อ node id ใน `main.ts` (`Map<string, Promise<void>>` แล้ว `.then` ต่อท้าย) ไม่ต้องแตะ scene layer

**ตรวจว่าสำเร็จ** เขียน test ใน core ไม่ได้เพราะ race อยู่ใน `main.ts` — ยืนยันด้วย manual QA
(เพิ่มขั้นใน `docs/qa-checklist.md`): เปลี่ยนสีจาก swatch ขณะที่ช่อง weight ยังมีค่าที่พิมพ์ค้าง
แล้วดูว่าได้ทั้งสองค่า

**ความเสี่ยง/ชนกับใคร** `main.ts` — ต่ำ

---

### A2 ✔️ ปิดแล้ว — จุด magnet เป็นปุ่มตายถ้า anchor ไม่ใช่ magnet

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `1e7d6e9` — เลือกทางที่ 1
> (ตัด union) `Anchor` จาก union 3 แบบเหลือ `interface` เดียว · `ratioPoint` ถูกลบ ·
> สาขา no-op ใน `updateConnectorAnchorSide` หายไป · coverage `src/core/**`
> **90.76 → 91.13 stmts · 86.58 → 87.40 branch**

ปัญหาเดิม: `Anchor` เป็น union 3 แบบ (`magnet` · `ratio` · `free`) แต่ `summariseSelection`
(`main.ts:191-192`) ยุบเหลือ `Magnet` เดียว และ `connectorScene.ts:1150`
`if (anchor.kind !== 'magnet') return` เงียบสนิท → ถ้า anchor เป็น `ratio`/`free`
คลิกจุด magnet ใน panel จะไม่เกิดอะไรเลย

**สิ่งที่ตัดสิน** ทางที่ 1 — ไม่มีโค้ดไหนสร้าง `ratio`/`free` เลย สาขาที่ resolve มันจึงไปไม่ถึง
และสาขา no-op ที่มันเป็นเหตุผลให้มีอยู่ ก็ทำให้จุด magnet ทุกจุดเป็นปุ่มตายสำหรับ state
ที่ไม่มีโค้ดไหนสร้างได้ (V2 ปิดไปพร้อมกัน)

**สิ่งที่คงไว้และเพราะอะไร** `kind` ยังอยู่ โดยมีค่าเดียว — มันอยู่บน disk ในทุก record
ที่เขียนไปแล้ว และเป็น seam ที่จะขยายถ้าวันหนึ่งมี kind ที่สองจริงๆ

**สิ่งที่เปลี่ยนพฤติกรรมการ parse** record ที่ `kind` ไม่ใช่ `'magnet'` (คือ `ratio`/`free`
ที่ build ในอนาคตเขียน) ถูก **ปฏิเสธทั้งก้อน** ไม่ใช่ซ่อม — ต่างจาก style field ที่ fallback
ทีละช่อง เพราะไม่มี default endpoint ที่ไม่ใช่ "เส้นที่ลากไปที่ที่เจ้าของไม่ได้วางไว้"
ADR 0001 บันทึกเหตุผลนี้ไว้แล้ว

---

### A3 ✅ แก้ label แล้วค่าที่พิมพ์ค้างในช่องอื่นหาย

**หลักฐาน**

- `src/ui.tsx:1251` — `key={`${...id}:${...annotationText ?? ''}`}`
- `src/ui.tsx:1282` — `key={`${...id}:${...connectorStyle?.label ?? ''}`}`

**อาการ** `key` มีเนื้อหาของ record อยู่ในตัว → blur ที่ช่อง label ทำให้ record เปลี่ยน → `key` เปลี่ยน
→ subtree remount → `weightText` / `opacityText` / `radiusText` ที่ยังพิมพ์ค้างถูกรีเซ็ตกลับเป็นค่าจาก record

**สิ่งที่ต้องทำ** เอาเนื้อหาออกจาก `key` ให้เหลือ id เดี่ยว แล้วจัดการ sync ค่าจากภายนอกด้วย
`useEffect` ที่ดูเฉพาะ id — หรือดีกว่านั้นคือย้าย "ค่าที่พิมพ์ค้างควรถูกเขียนทับเมื่อไหร่" ไปเป็น
pure function ใน core แล้ว test มัน (ต่อกับ B5)

**หมายเหตุ** `key` แบบนี้เดิมมีไว้เพื่อให้ textbox รับค่าใหม่จากภายนอก — แก้แบบไม่คิดจะทำให้
ช่อง label เลิก refresh เวลาเลือก connector อื่น ต้องมี test หรือ QA step กันไว้

**ความเสี่ยง/ชนกับใคร** `ui.tsx` — พี่นุ่นแตะไฟล์นี้ 2 ครั้งใน 20 commit หลัง กลาง

---

### A4 ✔️ ปิดแล้ว — `ensureOnPage` ตัวที่สองใน `syncConnectorBody` ไม่มีการเขียนตำแหน่งคืน

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `d79e5fa`
> `connectorScene.ts:865-880` — อ่าน `absoluteTransform` ก่อน `ensureOnPage` แล้วเขียน
> `node.x`/`node.y` คืนหลัง เหมือน `:783-788`

**ตัดสินว่าเป็นแบบไหน: มันทำงานได้จริง ไม่ใช่ dead call** ทุก `await` ใน
`positionPolyline`/`positionCurve` คืน main thread ให้ Figma และเส้นถูกปล่อยไม่ให้ล็อกโดยตั้งใจ
(เพื่อให้ style panel ทำงาน) → คนลากเส้นเข้า frame ได้ในช่วงนั้น และไม่มีที่อื่นใน function นี้
reparent มันกลับ จึงเป็นจุดเดียวที่จับได้ คอมเมนต์ที่ `:865-874` อธิบายไว้แล้ว

---

## 2. งาน architecture

เรียงตาม **ความเสี่ยงที่จะชนกับ commit ที่ทำอยู่** จากน้อยไปมาก ไม่ใช่ตามหมายเลข candidate เดิม

### B1 ✔️ ปิดแล้ว — หด interface ที่ export เกิน (candidate 3 — ขยายขอบเขต)

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `fbc9fa9` (constant 13 ตัว) ·
> `db52b95` (router internal 3 ตัว) · `bf52f99` (`FRAME_CLEARANCE_MARGIN`)
> `src/core/connector.ts` จาก **50 → 33 export** · test 272 → 262 ·
> coverage `src/core/**` **90.76 / 86.58 / 93.97 เท่าเดิมทุกตัว**

ตรวจแล้วว่าเป็นปัญหาทั้ง repo ไม่ใช่แค่ `connector.ts` และ **ไม่มี export ตัวไหนตายสนิท** —
ทุกตัวที่ prod ไม่เรียกถูกใช้ในไฟล์ตัวเอง มันคือ over-export

| ไฟล์ | export | prod ไม่เรียก แต่ test เรียก | prod+test ไม่เรียก (ใช้แต่ในไฟล์ตัวเอง) |
|:--|--:|--:|--:|
| `src/core/connector.ts` | 50 → **33** | 18 | 2 (`FRAME_CLEARANCE_MARGIN:1205`, `ConnectorCurve:1558`) |
| `src/core/annotation.ts` | 33 → **32** | 11 | 3 (`LayoutMetrics`, `AnnotationLayout`, `StackableCard`) |
| `src/core/anchor.ts` | 17 → **16** | 1 (`resolveMagnetPreferringSides`) | 1 (`ResolvedPair`) |
| `src/core/drawnShape.ts` | 11 | 3 | 3 (`DrawnSegment:23`, `TangentSegment:152`, `TangentNetwork:157`) |
| `src/core/category.ts` | 9 | 0 | 0 |
| `src/core/obstacleScan.ts` | 4 | 0 | 0 |

**⚠️ ข้อที่รีวิวเดิมไม่ได้แยก** ของ 18 ตัวใน `connector.ts` มีสองกลุ่มที่ต้นทุนต่างกันคนละเรื่อง

**กลุ่มที่ 1 — constant (13 ตัว) ✔️ ทำแล้ว (`fbc9fa9`)**
`CONNECTOR_VERSION:23` · `DEFAULT_CONNECTOR_WEIGHT:143` … `DEFAULT_LABEL:151` ·
`DEFAULT_CONNECTOR_STYLE_PREFS:181` · `ELBOW_STUB:456` · `OBSTACLE_CLEARANCE:969`

test import ค่าพวกนี้มาเป็นค่าที่คาดหวัง ซึ่งเป็น test ที่จับ bug ไม่ได้ —
`expect(record.strokeWeight).toBe(DEFAULT_CONNECTOR_WEIGHT)` ผ่านเสมอไม่ว่าค่านั้นจะถูกหรือผิด
เอา `export` ออกแล้วให้ test เขียนเลขจริงลงไป ได้ทั้งการหด interface และ test ที่จับของได้จริง

พิสูจน์แล้วว่าได้ผล: หลังแก้ เปลี่ยน `DEFAULT_CONNECTOR_WEIGHT` จาก 1.5 เป็น 2 ทำให้ **4 test แดง**
ก่อนแก้ไม่แดงเลยแม้แต่ตัวเดียว

**กลุ่มที่ 2 — function (5 ตัว) ✔️ ตัดสินแล้ว: ตัด 3 คง 2**

`routeCrossings:512` · `routeCost:570` · `edgesOn:578` · `findRouteAround:792` · `clearanceBeside:985`
(+ `obstaclesInPlay:910` ที่ prod เรียกด้วย จึงต้องคง export)

**❌ ข้อที่เอกสารฉบับก่อนบอกผิด** เอกสารเขียนว่าทั้ง 5 ตัวถูกทดสอบซ้ำผ่าน `connectorRoutePoints`
อยู่แล้ว วัดจริงแล้ว **ซ้ำแค่ 3 ตัว** อีก 2 ตัวไม่ซ้ำ และห้ามตัด

| function | ตัด test ตรงแล้วเกิดอะไร | ผล |
|:--|:--|:--|
| `routeCost` `edgesOn` `clearanceBeside` | coverage `src/core/**` = **90.76 / 86.58 / 93.97 เท่าเดิมทุกทศนิยม** | ✔️ un-export แล้ว (`db52b95`) |
| `routeCrossings` | **9 test พังทันที** — มันคือเครื่องวัดของ `connectorRoutePoints — obstacle avoidance` 19 assertion (`routeCrossings(before) === 1`, `after === 0`) ตัดแล้วต้องเขียนใหม่เป็นพิกัดตายตัว ซึ่งเปราะกว่า | คง export |
| `findRouteAround` | `connector.ts` 87.78 → **83.71** stmts · branch 81.6 → **77.46** — เสีย 18 statement ในตัว A* เอง (search loop, cost cap, ทางยอมแพ้) ซึ่ง public interface ไม่แตะเลย และทำให้ทั้ง core ต่ำกว่าเกณฑ์ 90.76 | คง export |

บทเรียน: "test เรียกตัวเดียว → over-export" เป็นสัญญาณ ไม่ใช่ข้อสรุป ต้องวัด coverage ก่อนตัดทุกครั้ง
วิธีวัด: ลบ describe ที่ยิงตรงออก แล้ว `npx vitest run --coverage --coverage.reporter=json-summary`
เทียบ `coverage/coverage-summary.json` (อย่าอ่าน text table — ดู T3)

**🆕 `annotation.ts` — ตรวจแล้ว ไม่ควรทำ**

5 function ที่มีแต่ test เรียก (`annotationLayout:304` · `resolveOutsideSide:579` ·
`annotationLayoutOutsideFrame:597` · `shrinkToFit:372` · `floorFor:358`) วัดแล้วตัดไม่ได้:

- ลบ describe ที่ยิงตรงทั้ง 5 (24 test) → statement เท่าเดิม (99.13) แต่ **branch 96.96 → 91.91**
  แปลว่า test ตรงพวกนี้ถือ edge case ที่ `computeLayout` ไปไม่ถึง
- test ของ `computeLayout` ใช้ทั้ง 5 ตัวเป็น oracle อยู่ 10 จุด (เช่น `:622`
  `expect(resolved.layout).toEqual(annotationLayout(target, record(), DEFAULT_METRICS))`)
  ตัดแล้วต้องเขียน expectation เป็นพิกัดตรงๆ

`ratioPoint` กับ `resolveMagnetPreferringSides` ใน `anchor.ts` ไม่ได้ตัดในรอบ B1 เพราะผูกกับ
การตัดสินใจใน **A2/V2** ไม่ใช่ B1 — `ratioPoint` ถูก**ลบทั้งตัว**ไปแล้วใน `1e7d6e9` พร้อมกับ
anchor kind ที่มันมีอยู่เพื่อรองรับ · `resolveMagnetPreferringSides` ยังอยู่ (prod เรียกผ่าน
`resolveMagnetEscapingFrame`) และ `annotation.ts` เสีย 1 export จาก `ANNOTATION_VERSION` ใน `696e214`

**ข้อควรระวังเรื่อง type** un-export type ได้เฉพาะตัวที่ไม่ปรากฏใน signature ของ function ที่ยัง public
`StackableCard` เป็น parameter type ของ function ที่ export อยู่ (`annotation.ts:647`) —
caller สร้าง object แบบ structural ได้โดยไม่ต้อง import ชื่อ แต่จะเขียน annotation ไม่ได้
ตรวจตามกฎนี้แล้วทั้ง 9 ตัวในคอลัมน์ขวาสุดของตารางข้างบน มีแค่ `FRAME_CLEARANCE_MARGIN` ที่ผ่าน
(มันเป็น default value ของ parameter ตัวท้ายของ `connectorStubClearance` ซึ่ง caller ไม่ส่ง) —
ที่เหลืออยู่ใน signature หรือเป็น field ของ interface ที่ public จึงคงไว้ทั้งหมด

**ตรวจว่าสำเร็จ** `npm run typecheck && npm run lint && npm test` ผ่าน และ
coverage `src/core/**` ไม่ต่ำกว่า 90.76% stmts — ✔️ ผ่านทั้งหมด (จำนวน test ลด 10 ตัวโดยตั้งใจ
เพราะเป็น test ที่ไม่ถือ coverage ของตัวเอง)

**ความเสี่ยง/ชนกับใคร** อยู่ใน `src/core/**` + `test/**` เกือบทั้งหมด — **ต่ำ** เป็นข้อที่เริ่มได้ปลอดภัยสุด

---

### B2 ✅ index เดียวแทน "หา node ที่เป็นของ owner นี้" สองชุด (candidate 4)

**หลักฐาน — ทั้งสองชุด ตำแหน่งจริงวันนี้**

| งาน | annotation | connector |
|:--|:--|:--|
| cache owner ของ node ที่ถูกลบ | `annotationScene.ts:166` `ownerIdByRenderedNodeId` | `connectorScene.ts:310` `labelOwnerByRenderedNodeId` |
| อ่าน cache | `:183` `lastKnownOwnerOf` | `:342` `lastKnownLabelOwnerOf` |
| scan ทั้ง page ครั้งเดียว | `:225` `collectRenderedByOwner` | `:289` `collectConnectorLabels` |
| scan ต่อ owner | `:255` `findRenderedNodes` | `:267` `findLabelsFor` |
| dedupe เมื่อเจอซ้ำ | `:209-214` `dedupe` → `:284-291` `removeIfPresent` | `:263` inline |
| map node ที่เลือก → owner | `:315` `annotationTargetsBehind` | `:320` `connectorsBehindLabels` |

ปลายทางของสองแถวสุดท้ายคือจุดเดียวกัน — `main.ts:131-137` `resolveSelectionOwners` เอาผลสองฝั่ง
มา merge กลับเป็น `Map` เดียว:
```ts
const owners = new Map<string, SceneNode>(annotationTargetsBehind(nodes))
for (const [pillId, connector] of connectorsBehindLabels(nodes)) {
  owners.set(pillId, connector)
}
```
โค้ดที่ต้องเอาผลของสองระบบมาต่อกันเองแบบนี้ คือหลักฐานว่ามันควรเป็นระบบเดียวมาแต่แรก

สำนวน `typeof x === 'undefined' ? set([node]) : push` ก๊อปมาทั้งดุ้น เทียบ
`annotationScene.ts:230-232` กับ `connectorScene.ts:297-299`

**⚠️ สำเนาสองชุดเพี้ยนไปคนละทางแล้ว — ตรวจยืนยันแล้ว**

`connectorScene.ts:263`
```ts
for (const node of found) node.remove()
```
`annotationScene.ts:284-291`
```ts
function removeIfPresent(node: BaseNode | null): void {
  if (node !== null && !node.removed) {
    node.remove()
    ownerIdByRenderedNodeId.delete(node.id)
    roleByRenderedNodeId.delete(node.id)
  }
}
```
ฝั่ง connector ต่างสองอย่าง: **ไม่เคลียร์ `labelOwnerByRenderedNodeId`** และ
**ไม่เช็ค `.removed` ก่อนเรียก `.remove()`**

ฝั่ง connector มีที่เคลียร์ map ถูกต้องอยู่ที่ `:476` และ `:502` — แปลว่ารู้ว่าต้องทำ แต่ทำไม่ครบทุกทาง
นี่คือสิ่งที่จะเกิดเรื่อยๆ ตราบใดที่ยังมีสองชุด

**ต้นแบบที่มีอยู่แล้วใน repo** `src/scene/orphans.ts` (21 บรรทัด) คือสิ่งเดียวที่ deduplicate สำเร็จ
ทั้งสองฝั่งเรียก `removeOrphansByOwnerKey` ตัวเดียวกัน (`annotationScene.ts:360`,
`connectorScene.ts:1157`) call site เหลือบรรทัดเดียว

**สิ่งที่ต้องทำ** module เดียวรับ `ownerKey` เป็น parameter ให้ครบทั้ง 6 งานในตารางข้างบน
แล้วให้ทั้งสองฝั่งเรียกตัวเดียวกัน

**ตรวจว่าสำเร็จ** `grep -c 'findAllWithCriteria' src/scene/*.ts` ต้องลดลง และการลบ label ซ้ำ
ต้องเคลียร์ cache (เขียน test ได้ถ้า index แยกออกมาเป็น module ที่รับ node list เป็น input)

**ความเสี่ยง/ชนกับใคร** แตะ `annotationScene.ts` + `connectorScene.ts` ซึ่งเป็นไฟล์ที่ commit ล่าสุด
ลงบ่อยสุด — **สูง** ควรทำเป็น branch สั้น merge เร็ว

---

### B3 ✅ เปลี่ยน suppress flag จากกฎที่ต้องจำ ให้เป็น type error (candidate 2)

**หลักฐาน — วัดจริงแล้ว** นับ mutating call (`setPluginData` · `.remove()` · `appendChild` ·
`insertChild` · `setVectorNetworkAsync`) ใน `src/scene/**` ได้ **26 จุด** ในนั้น

- **อยู่ใน suppress window แบบเห็นได้จากบรรทัดนั้น: 4 จุด** — `annotationScene.ts:143`, `:152`,
  `connectorScene.ts:101`, `categoryScene.ts:24`
- **อีก 22 จุด ต้องไล่ caller chain ทั้งสายจึงจะรู้ว่าถูกป้องกันหรือไม่**

suppress window ที่มีอยู่ทั้งหมด: `annotationScene.ts:142-147`, `:151-154`, `:757-832`, `:943-969` ·
`connectorScene.ts:100-102`, `:768-877` · `categoryScene.ts:23-25`

**🆕 หลักฐานว่ามันหลุดจริง ไม่ใช่แค่ "ตรวจไม่ได้"**

`src/main.ts` **ไม่เคยเรียก `withSuppressedNodeChange` เลย** (`grep` เจอแค่คอมเมนต์ที่ `:355`) แต่
`main.ts:558` เรียก `removeConnectorLabel(id)` ซึ่ง `connectorScene.ts:475` ทำ `label.remove()`
→ write นี้ทำงานตอน `suppressDepth === 0` แน่นอน

ผลกระทบต่อผู้ใช้ในเส้นทางนี้ยังไม่ได้ยืนยัน (มันอยู่ในสาย DELETE ที่ connector ถูกลบไปแล้ว
การ echo กลับจึงน่าจะไม่มีผล) — แต่ประเด็นของ candidate นี้ไม่ใช่ bug ตัวใดตัวหนึ่ง มันคือว่า
**อ่านจากบรรทัด write แล้วบอกไม่ได้ว่าถูกป้องกันหรือเปล่า** ต้องไล่ทั้ง call chain ทุกครั้ง

**หลักฐานว่ากลไกนี้รู้ตัวว่าไม่พอ** `connectorScene.ts:61-70` เขียนไว้ตรงๆ ว่า suppression
ตอบคำถาม "เราเขียนเองหรือคนเขียน" ไม่ได้ เพราะมันปล่อยหลัง write ไปหนึ่ง tick และ
`nodechange` ของ vector write มาถึงหลัง window ปิดได้ — นั่นคือเหตุผลที่ `shapeFingerprint` มีอยู่
แปลว่าตอนนี้มีสองกลไกตอบคำถามเดียวกัน อันหนึ่งอิงเวลา (ไม่น่าเชื่อถือ) อีกอันอิงเนื้อหา (เชื่อถือได้)
แต่ `CLAUDE.md` เขียนกฎไว้เฉพาะอันที่ไม่น่าเชื่อถือ

**สิ่งที่ต้องทำ** ให้ `SceneWriter` handle เป็นทางเดียวที่เข้าถึง `setPluginData` / `remove` /
`appendChild` / `setVectorNetworkAsync` ได้ และหยิบได้จากในหน้าต่างเท่านั้น
`withSceneWrite(w => { ... })` — เขียนตรงโดยไม่มี handle ต้องไม่ compile

**ข้อควรคิดก่อนทำ** ทำแบบนี้จริงต้องแตะทุก write path ในสองไฟล์ใหญ่ และ `src/scene/pluginData.ts`
(46 บรรทัด 0 figma ref) จะกลายเป็นของที่ test ได้ด้วย fake timer — แต่ควรทำ **หลัง** B2
ไม่ใช่ก่อน เพราะทั้งสองข้อเขียน write path ใหม่ทั้งคู่ ทำพร้อมกันแล้วแยกไม่ออกว่าอะไรพัง

**ความเสี่ยง/ชนกับใคร** **สูงสุดในเอกสารนี้**

---

### B4 ✅ ที่เหลือของ candidate 1 — `frames.ts`

⚠️ รีวิวเดิมบอกว่า `frames.ts` มี 2 figma ref และต้องแยกก่อนย้าย ซึ่งถูก แต่ไม่ได้บอกว่าแยกที่ไหน
ตรวจแล้ว — `figma.` ทั้งสองครั้งอยู่ใน function เดียว

| function | บรรทัด | figma global | ย้ายเข้า core ได้ |
|:--|:--|:--|:--|
| `ensureOnPage` | `:21-24` | `figma.currentPage` × 2 | ไม่ได้ — ต้องอยู่ scene |
| `raiseAbove` | `:34-40` | ไม่มี (อ่าน `.parent` / `.children` / `.removed`) | ได้ |
| `findEnclosingFrame` | `:48-56` | ไม่มี | ได้ |
| `topLevelAncestorIdOf` | `:79-87` | ไม่มี | ได้ |

`test/frames.test.ts` เคยมีอยู่และทดสอบสามตัวนี้ด้วย object tree ธรรมดา — commit `47585b5`
(revert งาน section-parenting) ลบไฟล์ test ทิ้งพร้อมกับโค้ดที่ revert ทำให้หลักฐานว่าทำได้หายไป
งานนี้จึงเป็นการเอาตาข่ายกลับมา ไม่ใช่การสร้างใหม่

**ของอีกสามตัวที่ pure แล้วและยังอยู่ใน scene** ตรวจ figma ref ในตัวมัน = 0 ทั้งสามตัว

| function | ที่อยู่ | หมายเหตุ |
|:--|:--|:--|
| `drawnShapeOf` | `connectorScene.ts:427-434` | 8 บรรทัด อ่าน `node.absoluteTransform` / `node.vectorNetwork` แล้วส่งต่อให้ `walkDrawnShape` ที่อยู่ใน core แล้ว |
| `updateCardFromDrag` | `annotationScene.ts:1102+` | เรียก `findRenderedNodes` ซึ่งแตะ `figma.currentPage` → **ต้องแยก decision ออกจากการ scan ก่อน** ไม่ใช่ย้ายทั้งก้อน |
| `polylineNetwork` | `annotationScene.ts:547-` | pure จริง ย้ายได้เลย |

**❌ ที่ไม่แนะนำให้ย้าย** `src/scene/chunking.ts` (13 บรรทัด: `CHUNK_SIZE = 20` +
`yieldToMainThread` ที่ห่อ `setTimeout`) — pure จริง แต่ไม่มี decision ให้ test
ย้ายแล้วได้แค่ความเป็นระเบียบ ไม่ได้ตาข่าย รีวิวเดิมนับมันรวมมาด้วยเพราะนับจาก "figma ref = 0"
ซึ่งเป็นเกณฑ์ที่หยาบเกินไป

**ความเสี่ยง/ชนกับใคร** เป็นงานที่ commit ล่าสุดกำลังทำอยู่พอดี — **ควรเช็คก่อนว่ายังไม่มีใครถืออยู่**

---

### B5 ✅ ดึง decision ออกจาก `ui.tsx` (candidate 6)

**สถานะวันนี้** 1,315 บรรทัด · 20 component · 15 `useState` · 2 `useEffect` · **0 figma ref** · **0 test**

ไฟล์นี้ไม่แตะ `figma` เลย แปลว่า decision ในนั้น test ได้ทั้งหมด ติดแค่ `vitest.config.ts`
include เฉพาะ `test/**/*.test.ts` บน `environment: 'node'` และไม่มี test เขียนไว้

**หลักฐานความซ้ำ ตำแหน่งจริงวันนี้**

- predicate เดียวกันเป๊ะ เขียนสองรอบ — `ui.tsx:760` และ `:842`:
  `style.lineStyle === 'ELBOW' && !style.manualGeometry`
- parse + clamp ตัวเลข สามชุด ไม่ตรงกัน — `:715` (weight) · `:734` (opacity) · `:765` (radius)
- `key` ที่มีเนื้อหา record อยู่ในตัว — `:1251`, `:1282` (คือ A3)

**⚠️ กับดักที่มีคนเหยียบไปแล้วรอบหนึ่ง** อ่าน "ข้อควรรู้ที่ได้จาก `030cde9`" ท้ายหัวข้อ 0 ก่อนแตะ
ช่องตัวเลขทั้งสามช่อง

**ก้าวแรกที่ปลอดภัยสุด** แยก SVG glyph ออกเป็น `src/ui/glyphs.tsx` — เป็น markup ล้วน ความเสี่ยงศูนย์
แล้วค่อยดึง `visibleConnectorControls(style)` และ `parseStrokeWeight` / `parsePercent` /
`parseCornerRadius` เข้า core พร้อม test

**ความเสี่ยง/ชนกับใคร** กลาง

---

### B6 ✅ ผ่า `connector.ts` (candidate 5)

**สถานะวันนี้** 1,657 บรรทัด · 50 export · coverage 87.78% stmts (ต่ำสุดใน core นอกจาก `category.ts`)

**หลักฐานว่า concern สานกันจริงในระดับกลไก ไม่ใช่แค่สไตล์ — ตรวจยืนยันแล้ว**

- forward reference ข้าม ~356 บรรทัด: `:629` เรียก `clearanceBeside` ที่ประกาศที่ `:985`
- `ConnectorRecord.manualShape` ที่ `:140` อ้าง type `ManualShape` ที่ประกาศที่ `:650`
- `ELBOW_STUB` (`:456`) ค่าเดียวถูกอ้างจาก **3 concern ที่ไม่เกี่ยวกัน**:
  `:986-987` (`clearanceBeside`) · `:1222-1233` (`connectorStubClearance` — ระยะเลี่ยง frame) ·
  `:1546-1547` (ค่า default ของ `connectorRoutePoints`) แก้เพราะเหตุผลนึง กระทบอีกสอง

**ลำดับการตัดที่ edge น้อยสุดไปมากสุด** manual shape (0 edge) → A* search (1 edge, ต่อผ่าน
`orSearched`) → record/validation (2 type union) → geometry helper เหลือ elbow router ~750 บรรทัด
เป็น deep module อันเดียว ซึ่งเป็น concern เดียวจริงๆ ไม่ควรแยกต่อ

**⚠️ ข้อควรระวังที่ต้องบอกให้ชัด** git ตาม rename ทั้งไฟล์ได้ แต่ตาม**การแตกไฟล์**ไม่ได้
ทุก commit ที่ลงใน `connector.ts` หลังจาก branch นี้เปิด จะกลายเป็น conflict ที่ต้องแก้มือ
**ทำข้อนี้ท้ายสุด และทำใน branch ที่ merge ภายในวันเดียว**

**ความเสี่ยง/ชนกับใคร** สูงถ้า branch อยู่นาน · ต่ำถ้า merge เร็ว

---

### B7 ✅ message contract เป็น union + ช่องบอกความล้มเหลว (candidate 7)

**สถานะวันนี้** `src/messages.ts` 179 บรรทัด · 26 `export interface` (13 คู่ payload/handler) ·
ไม่มี discriminated union · ไม่มี `COMMAND_FAILED`

**⚠️ ตรวจแล้ว: วันนี้ยังครบ** handler interface 13 ตัว หัก 2 ตัวที่เป็นทาง main→ui
(`SelectionChangedHandler`, `CategoriesChangedHandler`) เหลือ 11 ตัวที่ต้องลงทะเบียนใน `main.ts`
และ `main.ts` ลงทะเบียนไว้ **11 ตัวพอดี** — ไม่มีตัวไหนหลุดตอนนี้ ประเด็นคือ
**ไม่มีอะไรบังคับ** เพิ่ม message ตัวที่ 14 แล้วลืม `on()` ก็ compile ผ่านและเงียบ

**หลักฐานว่าไม่มีช่องบอกความล้มเหลว** `main.ts:318-320`:
```ts
const node = await figma.getNodeByIdAsync(targetId)
if (node === null || node.type !== 'VECTOR') return
```
UI ไม่เคยรู้ว่า command ตกไป และ handler ทุกตัวจบด้วย `return` เงียบๆ แบบนี้

ผลคือ UI ต้องเขียนโค้ดชดเชยพฤติกรรมของอีกฝั่งที่มันมองไม่เห็น — `ui.tsx:1047-1053` มีคอมเมนต์อธิบายไว้เอง
ว่า scene layer ปฏิเสธชื่อว่างเงียบๆ และถ้าไม่มีโค้ดชดเชย การลบชื่อทิ้งแล้วคลิกออกจะทำให้ช่องนั้น
ค้างว่างตลอดไป

**สิ่งที่ต้องทำ** `type UiToMain = …` / `type MainToUi = …` พร้อม exhaustiveness check ตรง
registration block และเพิ่ม `COMMAND_FAILED`

**ความเสี่ยง/ชนกับใคร** ต่ำ–กลาง (`messages.ts` เกือบไม่มีใครแตะ แต่ต้องแก้ทั้งสองฝั่งพร้อมกัน)

---

## 3. ของที่ตรวจแล้วไม่ใช่ปัญหา — ไม่ต้องทำ

### ❌ "ลบข้อความในป้ายเส้น กับในการ์ด ให้ผลไม่เหมือนกัน"

รีวิวเดิมบอกว่าการ์ดว่าง = ลบโน้ต แต่ป้ายเส้นว่าง = เก็บป้ายว่างไว้ **ตรวจแล้วไม่จริง**

`connectorScene.ts:498-504` ลบ pill ทิ้งเมื่อ text ว่าง:
```ts
const trimmed = text.trim()
if (trimmed === '') {
  if (existing !== null) {
    existing.remove()
    labelOwnerByRenderedNodeId.delete(existing.id)
  }
  return
}
```

และความต่างที่เหลือคือความต่างที่**ถูกต้อง**: การ์ดว่างเรียก `clearAnnotation(target)`
(`annotationScene.ts:1176-1179`) ซึ่งลบ record ทั้งก้อน เพราะ annotation ที่ไม่มีข้อความคือไม่มี annotation
ส่วน connector ที่ไม่มี label ยังเป็น connector อยู่ — `label: ''` จึงถูกแล้ว

---

## 4. dead / vestigial

### V1 ✔️ ปิดแล้ว — `field v` เป็น version marker ที่ทำงานไม่ได้

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `696e214` — เลือกทางที่ 1 (ลบ field)
> `ANNOTATION_VERSION` / `CONNECTOR_VERSION` ถูกลบทั้งคู่ · `v` ออกจากทั้ง 2 interface,
> 2 factory, 2 parser

`v` เขียนตอนสร้างแต่ตอน parse hardcode ค่าปัจจุบันทับ ไม่เคยอ่าน `candidate.v` → record
ที่เขียนโดย build เก่ารายงานตัวเองว่าเป็น version ปัจจุบันทันทีที่ถูกอ่าน ไม่มีทางรู้ว่าต้อง migrate

**เหตุผลที่เลือกลบ** marker ที่ตรวจอะไรไม่ได้แย่กว่าไม่มี เพราะมันอ่านเหมือนมี migration story
ที่ไม่มีอยู่จริง ของที่ทำให้ record เก่ายังใช้ได้จริงๆ คือ tolerant field-by-field decode —
field ที่ไม่รู้จักถูกเมิน field ที่หายไป fallback เป็น default ที่ตรงกับสิ่งที่วาดไว้ก่อนมี field นั้น
(`size` เป็นตัวอย่างที่เขียนไว้ในโค้ดแล้ว)

**สิ่งที่บันทึกไว้แทน** docstring ของ `parseAnnotationRecord` เขียนไว้ว่า tolerance นี่แหละคือ
versioning story ทั้งหมด และถ้าวันหนึ่งมีการเปลี่ยนที่ tolerance รับไม่ได้ (field ที่*ความหมาย*
เปลี่ยน ไม่ใช่ field ที่เพิ่มมา) marker จริงต้องเกิดตอนนั้น และต้องถือว่า `v` ที่ไม่มีอยู่
= "ทุกอย่างที่เขียนมาถึงตอนนี้" · `parseConnectorRecord` ชี้มาที่ docstring นั้น

record ที่อยู่บน disk แล้วยังมี `v` ติดอยู่ ซึ่ง decode เมินและการเขียนครั้งถัดไปทิ้งไปเอง

### V2 ✔️ ปิดแล้ว — anchor kind `'ratio'` / `'free'` ไม่มีใครสร้าง

ปิดพร้อม A2 ใน `1e7d6e9` — ดู A2

### V3 ✅ export ที่ไม่มีใครนอกไฟล์ใช้

`FRAME_CLEARANCE_MARGIN` (`connector.ts:1205`) · `ConnectorCurve` (`:1558`) และอีก 7 type
ในไฟล์อื่น — `annotation.ts` 3 · `drawnShape.ts` 3 · `anchor.ts` 1 (ดูตาราง B1) — รวมอยู่ใน B1 แล้ว ไม่ใช่งานแยก

---

## 5. test + config

| # | ข้อ | หลักฐาน | ทำอะไร |
|:--|:--|:--|:--|
| T1 ✔️ | test วัดเวลาจริง flaky ได้บน CI ที่โหลดหนัก และวัดค่าจูน ไม่ใช่สัญญา | เดิม `expect(Date.now() - start).toBeLessThan(200)` | **ปิดแล้ว** — `grep -n 'Date.now()' test/*.ts` = 0 hit |
| T2 ✔️ | test ที่อาจรัน 0 assertion | `if (routerKeepsIt) expect(...)` ผ่านได้โดยไม่ assert อะไร | **ปิดแล้ว** — `expect.hasAssertions()` ที่ `test/connector.test.ts:1086` |
| T3 ✔️ | `coverage` text report ไม่แสดง `src/core/obstacleScan.ts` ทั้งที่มัน **100%** | text table แสดง 5 ไฟล์ · `json-summary` แสดง 6 ไฟล์ (`obstacleScan.ts` 31/31 stmts) · ลอง `--coverage.skipFull=false` แล้วยังไม่โชว์ · `--coverage.skipFull=true` ทำให้แถวหายทั้งตาราง (vitest 4.1.11) | **ปิดแล้ว** (`1cf6133`) — `vitest.config.ts:20` reporters เป็น `['text', 'html', 'json-summary']` · สาเหตุที่ text reporter กรองแถวยังไม่ยืนยัน **อย่าเชื่อ text table เป็นแหล่งเดียว** |
| T4 ✅ | คอมเมนต์หัวไฟล์ไม่ตรงกับความจริง | `vitest.config.ts:3-4` เขียนว่า "Only `src/core/**` is unit tested: it is the one layer that never touches the `figma` global" — ประโยคหลังยังจริง แต่ประโยคแรกกำลังจะไม่จริงทันทีที่ B4 ลง | แก้พร้อม B4 |
| T5 ✔️ | ไม่มี lint plugin ของ Preact/React | ไฟล์ 1,315 บรรทัดที่มี 15 hook ไม่มีตาข่าย | **ปิดแล้ว** (`38d2353`) — `eslint.config.js:34-37` `rules-of-hooks: error` + `exhaustive-deps: warn` เป็นตาข่ายให้ B5 แล้ว |
| T6 ✅ | `eslint` ใช้ `recommendedTypeChecked` | `eslint.config.js:11` | อัปเป็น `strictTypeChecked` เป็น**ข้อเสนอ ไม่ใช่ bug** ควรลองแล้วดูว่าได้ error กี่ตัวก่อนตัดสินใจ |
| T7 ✔️ | `package.json` version ยัง `0.4.0` | หลัง `e1a61b2 chore: release 0.4.0` main เดินไปอีก 45 commit โดยไม่ bump | **ปิดแล้ว** (`f9df652`) — วันนี้ `0.5.0` · กฎที่ต้องถือต่อ: bump ทุกครั้งที่ merge งานที่เปลี่ยนพฤติกรรม ไม่งั้นระบุ build ที่รันอยู่ใน Figma ไม่ได้ ซึ่งสำคัญเพราะ distribution เป็น import manifest เอง |

---

## 6. ลำดับที่แนะนำ

ข้อจำกัดที่กำหนดลำดับ ไม่ใช่ความสำคัญ: **`connectorScene.ts` กับ `annotationScene.ts`
คือไฟล์ที่ commit ลงบ่อยสุด** (4 ครั้งจาก 20 commit หลัง ต่อไฟล์) ทุกข้อที่แตะสองไฟล์นี้
ควรเป็น branch สั้นที่ merge ภายในวันเดียว

| ลำดับ | ทำ | เพราะ |
|:--|:--|:--|
| 1 | ~~T1 T2 T3 T5 T7 + A1 A3~~ ✔️ | เล็ก อิสระต่อกัน ไม่แตะไฟล์ร้อน รวมเป็น branch เดียวได้ และ T5 เป็นตาข่ายให้ B5 · **T4 ยังค้าง** — คอมเมนต์หัว `vitest.config.ts` แก้พร้อม B4 (ลำดับ 4) |
| 2 | ~~B1~~ ✔️ | อยู่ใน `core/**` + `test/**` เกือบทั้งหมด ความเสี่ยงต่ำสุดในบรรดางาน architecture · ทำแค่ `connector.ts`; `annotation.ts` วัดแล้วไม่ควรทำ ดู B1 |
| 3 | ~~A4 + A2 + V1 + V2~~ ✔️ | A4 ปิดไปก่อนใน `d79e5fa` · A2/V2 ตัด anchor union (`1e7d6e9`) · V1 ลบ version marker (`696e214`) — ตัดสินใจสองเรื่องนี้พร้อมกันเพราะเป็นการเลือกว่า "ของที่ไม่มีใครใช้" คือ seam ที่เก็บไว้หรือความซับซ้อนที่ตัดทิ้ง |
| **4 ← ถัดไป** | B4 | เอา `test/frames.test.ts` กลับมา — เป็นตาข่ายให้ B2 กับ B3 **เช็คก่อนว่าไม่มีใครถืออยู่** · ปิด T4 ไปพร้อมกัน (คอมเมนต์หัว `vitest.config.ts`) |
| 5 | B2 | branch สั้น merge เร็ว |
| 6 | B3 | หลัง B2 เท่านั้น ทั้งสองข้อเขียน write path ใหม่ทั้งคู่ |
| 7 | B5 B7 | อิสระจากข้ออื่น ทำแทรกตอนไหนก็ได้ |
| 8 | B6 | ท้ายสุด เพราะการแตกไฟล์ทำให้ทุก commit ที่ลงทีหลังกลายเป็น conflict |

**ข้อที่ไม่ควรรวม branch เดียวกัน**

- B1 กับ B6 — แตะ `connector.ts` ทั้งคู่ ทำพร้อมกันแล้วแยกไม่ออกว่าอะไรทำ test แดง
- B2 กับ B3 — เขียน write path ใหม่ทั้งคู่ เหตุผลเดียวกัน

---

## 7. กฎที่ต้องไม่ทำหลุดระหว่างทาง

จาก `CLAUDE.md` — ข้อที่งานในเอกสารนี้มีโอกาสละเมิดโดยไม่ตั้งใจ

- **`src/core/**` ต้องไม่มี `figma` global** — วัดได้: `grep -c 'figma\.' src/core/*.ts` ต้องเป็น 0
  ทุกไฟล์ (วันนี้เป็น 0) B4 คือข้อที่เสี่ยงสุดเพราะย้ายโค้ดจาก scene เข้ามา
- **ห้าม silence กฎ async ของ Figma eslint** — B6 ที่ย้ายโค้ดข้ามไฟล์ทำให้ import เปลี่ยน
  ระวังการเผลอเติม `eslint-disable`
- **ห้ามอ่าน geometry กลับจาก node** — A4 เกี่ยวข้องตรงนี้: `absoluteTransform` ที่ `:783`
  อ่านเพื่อ *กู้ตำแหน่ง* หลัง reparent ไม่ใช่เพื่อคำนวณ route ถ้าแก้ A4 ต้องไม่เปลี่ยนสถานะนั้น
- **ยก suppress flag รอบทุก write** — B3 คือการทำให้กฎนี้เป็น type error ระหว่างที่ยังไม่ทำ
  กฎนี้ยังต้องจำเอง
- **commit เป็นก้าวเล็กที่ทำงานได้จริง**
- **รัน `npm run typecheck && npm test` หลังทุกการแก้ ก่อนรายงานว่าเสร็จ ทุกครั้ง ไม่ใช่เมื่อถูกขอ**

---

## 8. วิธี re-verify เอกสารนี้

เลขทุกตัวข้างบนมาจากคำสั่งพวกนี้ รันซ้ำได้เมื่อ main เดินไปแล้ว

```sh
# figma ref ต่อไฟล์ (core ต้องเป็น 0)
for f in src/core/*.ts src/scene/*.ts src/main.ts src/ui.tsx; do
  printf "%-40s %s\n" "$f" "$(grep -c 'figma\.' "$f")"
done

# mutating call ทั้งหมดใน scene + main
grep -n 'setPluginData\|\.remove()\|appendChild\|insertChild\|setVectorNetworkAsync' \
  src/scene/*.ts src/main.ts

# suppress window ทั้งหมด
grep -rn 'withSuppressedNodeChange' src/ --include='*.ts' | grep -v pluginData.ts

# coverage ที่เชื่อได้ (text table ไม่ครบ — ดู T3)
npx vitest run --coverage --coverage.reporter=json-summary

# ตัวเลข baseline
npm run typecheck && npm run lint && npm test && npm run build
```

การจัดประเภท export (prod / test-only / ใช้แต่ในไฟล์ตัวเอง) ใช้ script นี้ —
`python3 exports.py src/core/connector.ts`

```python
import re, subprocess, sys, pathlib
f = sys.argv[1]
pat = re.compile(r'^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)')
names = [(m.group(1), i) for i, line in enumerate(pathlib.Path(f).read_text().splitlines(), 1)
         if (m := pat.match(line))]
ls = lambda d: subprocess.run(['git', 'ls-files', d], capture_output=True, text=True).stdout.split()
def refs(name, files, exclude=None):
    out = []
    for p in files:
        if p == exclude: continue
        n = len(re.findall(r'\b' + re.escape(name) + r'\b', pathlib.Path(p).read_text()))
        if n: out.append(f'{pathlib.Path(p).name}:{n}')
    return out
print(f'{len(names)} exports in {f}\n')
for name, ln in names:
    prod, test = refs(name, ls('src'), f), refs(name, ls('test'))
    tag = 'TEST-ONLY' if not prod and test else ('INTERNAL-ONLY' if not prod and not test else '')
    print(f'{ln:>5}  {name:<30} prod={prod or "-"}  test={test or "-"}  {tag}')
```

`INTERNAL-ONLY` = ไม่มีใครนอกไฟล์ใช้ **แต่ไฟล์ตัวเองใช้** — อย่าลบ ให้เอา `export` ออก
ตรวจก่อนด้วย `grep -c '\bNAME\b' <ไฟล์>` ว่ามันถูกใช้ในไฟล์จริง

---

## 9. ที่มา

- architecture review rev.2 (`main @ 471a8fb`, 6 ก.ย. 2026) — งาน 7 candidate + bug 10 ข้อ
- tier 1–2 ของรีวิวนั้นทำแล้วผ่าน PR #1 (`28f8ebf`) และ PR #2 (`4a95eb7`)
- candidate 1 ทำไปแล้วเกินครึ่งผ่าน 9 commit ระหว่าง `d1c39a0` ถึง `924de93`
- เอกสารนี้คือส่วนที่เหลือ ตรวจซ้ำทุกข้อบน `5c05097`
