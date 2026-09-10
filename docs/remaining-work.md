# งานที่เหลือจาก architecture review

> **baseline เดิม:** `main @ 5c05097` · ตรวจเมื่อ 8 กันยายน 2026 —
> 272 tests / 6 files · coverage `src/core/**` 90.76% stmts · 86.58% branch · 97.5% funcs · 93.97% lines
>
> **จบแล้วทั้งหมด:** `main @ ec977ef` · **v0.7.0** · 10 กันยายน 2026
> `npm run typecheck` · `npm run lint` · `npm test` (**377 tests / 12 files**) · `npm run build` ผ่านทั้งหมด
> **coverage `src/core/**`:** **95.74% stmts · 93.89% branch** (baseline 90.76 / 86.58)
> ขึ้นทุกตัวเลข ทั้งที่ระหว่างทางลบ test ที่จับ bug ไม่ได้ทิ้ง 12 ตัว
>
> **ปิดครบทุกข้อ 21/21** — A1–A4 · B1–B7 · V1–V3 · T1 T2 T3 T5 T6 T7 ·
> T4 (ตรวจสองรอบ premise ผิด ไม่ต้องแก้)
>
> **ทดสอบด้วยมือใน Figma แล้ว ผ่านครบ** — ดู `docs/qa-checklist.md`

---

## 🔴 อ่านก่อน: สิ่งที่เกิดขึ้น *หลัง* งานในเอกสารนี้จบ

เอกสารนี้เป็นรายการงานจากรีวิว และรายการนั้นปิดครบแล้วจริง **แต่เรื่องที่สำคัญที่สุด
ของรอบนี้ไม่ได้อยู่ในรายการ** — มันโผล่มาตอนเอาไปทดสอบด้วยมือ

### QA ด้วยมือจับได้ 3 อย่างที่ test 377 ตัวจับไม่ได้เลย

| เจออะไร | ที่มา | แก้ที่ |
|:--|:--|:--|
| ปลั๊กอินปลุกตัวเองเป็นวง จน editor กระตุกตลอดเวลาที่เปิดค้าง | **B3 ทำพังเอง** | PR #9 (0.6.1) |
| พิมพ์แก้ข้อความบนการ์ดแล้วเด้งกลับเป็นข้อความเดิม | **B3 ทำพังเอง** | PR #9 (0.6.1) |
| เส้นที่ปลายทางถูกลบกลายเป็นเส้นประแดง แต่ไม่มีอะไรอธิบาย | ของเดิม เพิ่งเห็น | PR #10 (0.7.0) |

สองอันแรกอยู่ในโค้ดที่ **merge ไปแล้ว ผ่าน CI แล้ว และผมยืนยันไปแล้วว่าปลอดภัย**
โดยอ้างการวัดใน B3 ที่ครอบไม่ครบ

### ความผิดพลาดในการวัดของ B3 — บทเรียนหลักของรอบนี้

B3 วัดว่า property ไหน**ถูก**ตัวกรองทิ้ง แล้วสรุปว่า write ของปลั๊กอินไปไม่ถึงอะไร
จริงเฉพาะตัวที่วัด — และ**ไม่ได้วัดสามตัวที่รอดผ่าน** ซึ่งบังเอิญเป็นสามตัวที่ถูกเขียนทุก sync
พอดี (ตำแหน่งการ์ด · ข้อความในการ์ด · vertices ของเส้น)

fingerprint ที่ใส่ไว้กันการ**ทำผิด**ได้ แต่ไม่ได้กันการ**ถูกปลุก** ซึ่ง suppression เดิมกันทั้งสองอย่าง
→ เปิดรูที่มีรูปร่างตรงกับครึ่งที่ไม่ได้วัดพอดี

**กฎที่เขียนลง `CLAUDE.md` จากเรื่องนี้ 3 ข้อ** — ห้ามเขียนค่าที่ node ถืออยู่แล้ว (เป็นเรื่อง
ความถูกต้อง ไม่ใช่ความเร็ว) · write ที่รอดผ่านตัวกรองต้องระบุที่มาได้*ก่อน*ถูกนำไปทำอะไร ·
เวลาวัดว่า write ไหนปลอดภัย ให้ไล่ตัวที่**รอดผ่าน** ไม่ใช่ตัวที่ถูกดัก

### 🆕 CI แดงเงียบมาก่อนหน้านี้

ตอนจะ merge งานรอบนี้เจอว่า **CI บน main พังมาตั้งแต่ `f9df652`** — งานที่ลง main หลังจากนั้น
ไม่เคยถูกตรวจจริง สาเหตุคือ `engines` ตั้งขอบบนผิด (บอก `<11.12` แต่ของจริงพังตั้งแต่ 11.6.2
ซึ่งเป็นรุ่นที่เครื่องที่ใช้ทำงานรันอยู่พอดี) ตาข่ายจึงเงียบและปล่อย lock เสียผ่านไป
แก้ใน PR #6 พร้อมตารางที่วัดจริงทีละรุ่น และกฎ "push แล้วต้องดู CI"

### ข้อสรุปที่ต่างจากตอนเริ่ม

ตอนเริ่มรอบนี้เป้าหมายคือ "ปิดงานตามรีวิว" ซึ่งจบแล้วจริง — แต่ของที่มีค่าที่สุดที่ได้กลับเป็น
**สามอย่างที่ไม่มีในรีวิว** และทั้งสามมีจุดร่วมเดียวกัน: **เครื่องมือบอกว่าผ่าน ทั้งที่ไม่ผ่าน**

- CI เขียวไม่ได้แปลว่า CI ทำงาน
- 377 tests ผ่านไม่ได้แปลว่าโปรแกรมใช้งานได้
- การวัดที่ดูรัดกุมก็ยังพลาดได้ ถ้าไล่ผิดด้าน

---

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

### A1 ✔️ ปิดแล้ว — สั่งสองอย่างติดกันแล้วอันหลังทับอันแรก

> ลงแล้วบน main: `66b8a7f` — command ที่แก้ record เดียวกันเข้าคิวต่อกันด้วย promise chain ต่อ node id

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

### A3 ✔️ ปิดแล้ว — แก้ label แล้วค่าที่พิมพ์ค้างในช่องอื่นหาย

> ลงแล้วบน main: `4b2cb59` — เอาเนื้อหา record ออกจาก `key` เหลือ id เดี่ยว
> แล้วรับค่าจากภายนอกด้วย `useAdoptedFromOutside` แทนการ remount ทั้ง subtree

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

### B2 ✔️ ปิดแล้ว — index เดียวแทน "หา node ที่เป็นของ owner นี้" สองชุด (candidate 4)

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `8b4818c`
> เกิด `src/scene/ownership.ts` (174) + `src/core/ownerIndex.ts` (76) + `test/ownerIndex.test.ts` (138) ·
> `src/scene/orphans.ts` ถูกพับเข้าไป (ลบทิ้ง) · `annotationScene.ts` **-83 บรรทัด** ·
> `connectorScene.ts` **-47 บรรทัด**
> **owner-key page scan ใน `src/scene/**` จาก 5 → 1** · test 290 → 305 ·
> coverage `src/core/**` **91.49 → 91.72 stmts · 87.96 → 88.12 branch** · `ownerIndex.ts` 100%

ทั้ง 6 งานในตารางเดิมเหลือทางเดียว `ownership(key)` = index ต่อ pluginData key หนึ่งอัน
(ข้อมูลแยก พฤติกรรมร่วม) พร้อม `Meta` สำหรับของที่แต่ละฝั่งต้องจำเพิ่มต่อ node —
Annotate เก็บ role ไว้ที่นั้น Connect ไม่เก็บอะไร · ตอนนี้ key ถูกเขียนชื่อที่เดียวแล้วส่งเข้า
`ownership` ไม่มีที่อื่นอ่านมันอีก

**✅ สำเนาสองชุดเพี้ยนไปคนละทางจริง — และเพี้ยนมากกว่าที่เอกสารเดิมเจอ**

| ที่ | เพี้ยนอะไร |
|:--|:--|
| ลบ label ซ้ำ (`connectorScene`) | ไม่เคลียร์ owner cache **และ**ไม่เช็ค `.removed` — ฝั่ง annotation ทำทั้งสอง (เอกสารเดิมเจอข้อนี้) |
| orphan sweep (`orphans.ts`) | **ไม่เคลียร์ cache ทั้งสองฝั่ง** — 🆕 เจอตอนทำ |
| `applyCardStacking` (`annotationScene`) | **สำเนาที่สาม**ของ group-แล้วแยก-role และเก็บ node ตัวสุดท้ายที่เห็นต่อ role แทนที่จะเคลียร์คู่ที่กำกวมแบบอีกสองที่ — 🆕 เจอตอนทำ |

ทั้งสามทางเดียวกันหมดแล้ว ข้อสังเกตที่เอกสารเดิมเขียนไว้ยังยืน: ฝั่ง connector มีที่เคลียร์ map
ถูกต้องอยู่สองจุด แปลว่ารู้ว่าต้องทำ แต่ทำไม่ครบทุกทาง — นี่คือสิ่งที่จะเกิดเรื่อยๆ ตราบใดที่ยังมีสองชุด

**กฎที่ test ได้ อยู่ใน core** `core/ownerIndex.ts` ถือ `ownerIdOf` · `groupByOwner` ·
`resolveOwnersBehind` — รับ node list เป็น input ตามที่เอกสารเดิมตั้งเงื่อนไขไว้ ใช้ structural
type (`OwnedNode` = `{ id, getPluginData }`) แบบเดียวกับ `TreeNode` ใน B4
ส่วนที่เหลือใน `scene/ownership.ts` คือ page scan, การลบ, และ session cache ซึ่ง test ไม่ได้

**contract ที่สำคัญที่สุดและ test จับไว้แล้ว** `resolveOwnersBehind` **ต้องไม่เรียก `findOwners()`**
เมื่อไม่มี node ที่ถูก tag อยู่ใน selection — คือ selection ธรรมดาทุกครั้ง นี่คือเหตุผลที่มันรันบน
`selectionchange` ได้โดยไม่ scan page ทุกครั้งที่คนคลิก layer (`vi.fn` + `not.toHaveBeenCalled`)

**⚠️ `main.ts:132` ยัง merge สอง map อยู่ และควรเป็นอย่างนั้น** เอกสารเดิมบอกว่าการ merge
เป็นหลักฐานว่าควรเป็นระบบเดียว — ครึ่งแรกถูก (การ*ทำงาน*ควรเป็นชุดเดียว ซึ่งตอนนี้เป็นแล้ว)
แต่ *ข้อมูล*ต้องแยก: node ที่ถูกเลือกเป็น rendered node ของ annotation **หรือ** label ของ
connector ไม่ใช่ทั้งสอง และ owner ที่ได้เป็น type ต่างกัน (`SceneNode` เป้าหมาย vs `VectorNode` เส้น)
สอง index ที่ merge ตรงจุดใช้งาน คือรูปที่ถูกแล้ว

**ความเสี่ยงที่ประเมินไว้** สูง (แตะสองไฟล์ที่ร้อนสุด) — ลงเป็น commit เดียว typecheck/lint/test/build
ผ่านทุกขั้นระหว่างทาง

---

### B3 ✔️ ปิดแล้ว — แต่ทำคนละทางกับที่เอกสารเสนอ (candidate 2)

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `320a357` (วัด) · `be089c8` (ทำ)
> **`src/scene/pluginData.ts` ถูกลบทั้งไฟล์** — `withSuppressedNodeChange` /
> `withSuppressedNodeChangeAsync` / `isSuppressed` ไม่มีอยู่ในโปรเจกต์แล้ว
> เกิด `src/core/authorship.ts` (101) + `src/scene/removals.ts` (44) + `test/authorship.test.ts` (159)
> test 346 → **357** · coverage `src/core/**` **92.16% stmts · 88.71% branch** · `authorship.ts` 100%

**เอกสารเสนอ** ทำให้ `SceneWriter` handle เป็นทางเดียวที่เขียน node ได้ → "ลืมยก flag" กลายเป็น
compile error · **ที่ทำจริง** ให้ 2 งานที่เหลือมีคำตอบอิงเนื้อหา แล้ว**ลบกลไกทิ้งทั้งอัน**

#### สิ่งที่มาแทน — 3 กลไก เรียงตามลำดับที่ change เดินผ่าน

| # | กลไก | ตอบอะไร |
|:--|:--|:--|
| 1 | property filter (`core/nodeChanges.ts`) | echo ของ `pluginData` · การ reparent · badge/leader ที่ขยับ — ตกที่นี่หมด |
| 2 | fingerprint (`core/authorship.ts`) | 2 write ที่แยกไม่ออกจริงๆ — **ตำแหน่ง/ความกว้างของ card** กับ **รูปทรงของเส้น** |
| 3 | removal record (`scene/removals.ts`) | การลบ ซึ่งไม่เหลือเนื้อหาให้เทียบ — จำ id ตอนลบ แล้วใช้ครั้งเดียวตอน DELETE มาถึง |

#### จุดที่ยากที่สุด และเหตุผลที่ต้อง "จำ" ไม่ใช่ "คำนวณซ้ำ"

card ที่ถูก **stacking** ย้าย อยู่คนละที่กับที่ layout ของมันเองบอก — ถ้าเช็คด้วย
"อยู่ตรงที่ layout บอกไหม" card ที่ถูก stack ทุกใบจะถูกอ่านว่าโดนลาก
`syncAnnotationBody` กับ stacking pass จึง**บันทึกตำแหน่งที่เพิ่งเขียน**ลง pluginData
แล้ว `updateCardFromDrag` เทียบกับอันนั้นก่อนเชื่อว่ามีคนลาก

#### ทำไม fingerprint ของ card กับของเส้นตรงข้ามกัน

`shapeFingerprint` เก็บ vertex ไม่เก็บตำแหน่ง · `placementFingerprint` เก็บตำแหน่งกับความกว้าง
ไม่เก็บความสูง — เพราะแต่ละอันเก็บ**สิ่งที่ feature นั้นยกให้คนตัดสิน**: รูปทรงของเส้นเป็นของคน
ตำแหน่งไม่ใช่ · ตำแหน่งกับความกว้างของ card เป็นของคน ความสูงเป็นของข้อความ
ย้าย `shapeFingerprint` มาอยู่ไฟล์เดียวกันแล้ว คำถามเดียวจึงมีที่เดียว

#### ❌ แก้ข้อที่ผลการวัดเองบอกผิด

การวัดรอบแรกเขียนว่า `.remove()` ของเราเอง "จำเป็นต้องมี suppression" — **ไม่จริง**
`Ownership.remove` ลบ entry ออกจาก cache พร้อมกับลบ node อยู่แล้ว → ทุก path ที่ซ่อม
rendered node ที่ขาดคู่ หา owner ไม่เจอ → ไม่ทำอะไร การจำ id ที่ลบจึงเป็นการ**ประหยัดงาน**
(ไม่ให้ DELETE ของเราไปปลุก resync ที่ scan ทั้งหน้า) ไม่ใช่การแก้ correctness — เขียนไว้ในโค้ดแล้ว

#### ผลข้างเคียงที่ตั้งใจ

`CLAUDE.md` ข้อ "ยก suppress flag รอบทุก write" หายไป แทนที่ด้วย 3 กลไกข้างบนและลำดับที่เจอ
เป็นกฎที่**ตรวจได้จากบรรทัดที่เขียน** ไม่ต้องไล่ caller chain — ซึ่งเป็นปัญหาตั้งต้นของ candidate นี้
แก้ด้วยการเอากลไกออก ไม่ใช่ด้วยการเพิ่ม type

**ไม่มี test อัตโนมัติสำหรับ path เหล่านี้** (อยู่ใน scene ทั้งหมด) → เพิ่ม QA step 8 ข้อ
หัวข้อ "Telling our own writes from a person's"

---

### B4 ✔️ ปิดแล้ว — ที่เหลือของ candidate 1 — `frames.ts`

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `52e08ae` (frames.ts → `core/nodeTree.ts`) ·
> `d7d19cd` (`polylineAtOrigin` เข้า `core/drawnShape.ts`)
> `src/scene/frames.ts` **88 → 53 บรรทัด** · เกิด `src/core/nodeTree.ts` (111) + `test/nodeTree.test.ts` (185)
> test **280 → 290** · coverage `src/core/**` **91.11 → 91.49 stmts · 87.4 → 87.96 branch** ·
> `nodeTree.ts` 100% ทุกตัวเลข

**ที่ทำ**

| function | ไปไหน | เหลืออะไรใน scene |
|:--|:--|:--|
| `ensureOnPage` | อยู่ที่เดิม | ทั้งตัว — ต้องมี `figma.currentPage` |
| `raiseAbove` | กฎ → `needsRaising` ใน core | การ mutate (`appendChild`) |
| `findEnclosingFrame` | การเดิน → `enclosingFrameOf` ใน core | cast กลับเป็น `FrameNode` |
| `topLevelAncestorIdOf` | **ทั้งตัว** — คืน `string` ไม่ต้อง cast | ไม่เหลือ (caller import จาก core ตรงๆ) |

**❌ ข้อที่เอกสารฉบับก่อนบอกผิด** เขียนไว้ว่า `test/frames.test.ts` เดิม "ทดสอบสามตัวนี้"
และงานนี้คือ "เอาตาข่ายกลับมา ไม่ใช่สร้างใหม่" — **ตรวจแล้วไม่จริง** ไฟล์เดิม 98 บรรทัด
(`git show 47585b5^:test/frames.test.ts`) มี `describe` เดียวคือ `commonSectionOf`
ซึ่งเป็น function ที่ revert ลบไป ไม่เคยแตะสามตัวนี้เลย งานนี้คือ**เขียนตาข่ายใหม่**
ของที่กู้ได้จริงคือ *เทคนิค* — fake object tree + cast ตอนส่งเข้า function

**สิ่งที่ทำให้ core ยังไม่แตะ figma** ใช้ structural type (`TreeNode`, `StackedNode`,
`CappedVertex<Cap>`) ไม่ใช่ `SceneNode`/`VectorVertex` ของ Figma — เหตุผลเดียวกับที่ `Rect`
mirror `absoluteBoundingBox` และ `ConnectorCap` mirror `StrokeCap` ผลพลอยได้: test ใช้
object tree ธรรมดาได้ และแต่ละ interface ขอแค่ field ที่กฎนั้นอ่านจริง

**cast อยู่ที่ scene ไม่ใช่ core** `findEnclosingFrame` cast `TreeNode` → `FrameNode` เอง
เพราะมีแต่ layer ที่ถือ document จริงที่รู้ว่า node ที่รายงาน `type === 'FRAME'` คือ `FrameNode`
ถ้าให้ core ประกาศ return type เป็น `N | null` แบบ generic จะเป็นการโกหกใน type system
ที่ย้ายเข้าไปอยู่ใน core ซึ่งแย่กว่า cast หนึ่งจุดที่ scene

**🆕 ของที่ไม่ได้อยู่ในแผนเดิมแต่เจอตอนทำ — ซ้ำจริงสองชุด**

`polylineNetwork` (annotation) กับ `drawPoints` (connector) คำนวณ **min ต่อแกน + index chain**
เหมือนกันคนละที่ ทั้งสองตอบคำถามเดียวกัน: node บอกตำแหน่งเส้นสองครั้ง (ตัว node เอง + vertex
ที่วัดจาก origin ของ node) และสองอันต้องตรงกัน ไม่ตรงคือเส้นถูกวาดเยื้องจากที่ route ไว้
→ รวมเป็น `polylineAtOrigin` ใน `core/drawnShape.ts` พร้อมกฎ cap/rounding ที่เดิมอยู่แต่ในคอมเมนต์
(ปลายจริงได้ cap เพราะหักมุมคือมุมไม่ใช่ปลาย · หักมุมได้ rounding เพราะ cap วาดเลยปลายเส้นไป
การ round ปลายจึงไม่เห็นผล)

**ยังไม่ทำ และเพราะอะไร**

| function | ที่อยู่ | ทำไมยังไม่ย้าย |
|:--|:--|:--|
| `drawnShapeOf` | `connectorScene.ts` | 8 บรรทัดที่อ่าน `absoluteTransform`/`vectorNetwork` แล้วส่งต่อให้ `walkDrawnShape` ที่อยู่ใน core อยู่แล้ว — เป็น adapter ไม่มี decision ให้ test |
| `updateCardFromDrag` | `annotationScene.ts` | เรียก `findRenderedNodes` ซึ่งแตะ `figma.currentPage` → **ต้องแยก decision ออกจากการ scan ก่อน** ไม่ใช่ย้ายทั้งก้อน งานคนละขนาดกับ B4 |

**❌ ที่ไม่แนะนำให้ย้าย (ยังยืนอยู่)** `src/scene/chunking.ts` (13 บรรทัด: `CHUNK_SIZE = 20` +
`yieldToMainThread` ที่ห่อ `setTimeout`) — pure จริง แต่ไม่มี decision ให้ test
ย้ายแล้วได้แค่ความเป็นระเบียบ ไม่ได้ตาข่าย รีวิวเดิมนับมันรวมมาด้วยเพราะนับจาก "figma ref = 0"
ซึ่งเป็นเกณฑ์ที่หยาบเกินไป — **เกณฑ์ที่ใช้จริงใน B4 คือ "มี decision ที่ test จับ bug ได้ไหม"**
วัดด้วยการ mutate โค้ดแล้วดูว่า test แดง (ดูหัวข้อ 8)

---

### B5 ✔️ ปิดแล้ว — ดึง decision ออกจาก `ui.tsx` (candidate 6)

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `b8c06b0`
> `ui.tsx` **1,368 → 1,255 บรรทัด · 0 test → มีตาข่ายแล้ว** ·
> เกิด `src/core/panelFields.ts` (129) + `src/ui/glyphs.tsx` (110) + `test/panelFields.test.ts` (156)
> test 305 → **322** · coverage `src/core/**` **91.84 stmts · 88.22 branch** · `panelFields.ts` 100%

**ก้าวแรกตามที่เอกสารแนะนำ** SVG glyph (`CapGlyph`, `LineStyleGlyph`) ออกไปเป็น
`src/ui/glyphs.tsx` — markup ล้วน ไม่มี state ไม่มี message ไม่มี decision และเป็นก้อนใหญ่สุด
ในไฟล์ที่ไม่มีใครต้องอ่านเวลาทำงานกับพฤติกรรมของมัน

**`commitNumericField` — แทน parse+clamp สามชุดที่ไม่ตรงกัน**

| ช่อง | เดิมทำอะไร |
|:--|:--|
| weight | clamp ขึ้นถึง min **แล้วเขียนค่ากลับลงช่อง** |
| opacity | clamp สองด้าน แล้วเขียนกลับ |
| corner radius | **ไม่ทำทั้งสอง** — พิมพ์ `-5` ค้างอยู่บนหน้าจอโดยไม่เก็บอะไรเลย |

ผลของข้อที่สาม: "นอกช่วง" กับ "ไม่ใช่ตัวเลข" หน้าตาเหมือนกันเป๊ะ ทั้งที่ควรต่างกัน
ตอนนี้ทั้งสามช่อง clamp ตอน blur แล้วเขียนกลับ · ช่องว่างยังคงค่าที่อยู่บนจอไว้
เพราะช่องว่างคือ "คนกำลังพิมพ์" ไม่ใช่ "คนขอค่านี้"

**🆕 `minimum`/`maximum` ถูกเอาออกจาก opacity กับ radius ด้วย** เอกสารเตือนเรื่องกับดักนี้
สำหรับ weight (ที่ `030cde9` จ่ายค่าไปแล้ว) แต่ไม่ได้บอกว่า**อีกสองช่องยังมี prop นั้นติดอยู่** —
`minimum={0}` บน radius และ `minimum={0} maximum={100}` บน opacity วันนี้ยังไม่ทำให้ค่าไหน
พิมพ์ไม่ได้ (ต่างจาก `minimum={0.5}` ที่ฆ่าช่วง 0.5–0.9) แต่มันคือระเบิดเวลาลูกเดียวกัน
และทำให้ bound อยู่สองที่ · ตอนนี้ bound อยู่ที่ commit ที่เดียว

**`visibleConnectorControls`** แทน `lineStyle === 'ELBOW' && !manualGeometry` ที่เขียนซ้ำสองที่
และถือกฎที่มันพยายามพูด: เส้นที่ปรับเองแล้วยกรูปทรงให้คนไปแล้ว control ที่ตัดสินรูปทรง
จึงต้อง**หายไป ไม่ใช่กดไม่ได้** — control ที่ไม่ทำอะไรแย่กว่าไม่มี control

**mutation 7 แบบแดงหมด** Infinity หลุด · เก็บ text ที่ถูกปฏิเสธ · ไม่ clamp ด้านบน · ไม่ clamp เลย ·
elbow ไม่สนว่าเส้นปรับเองแล้ว · line style โชว์เสมอ · min ของ weight หายไป

**T4 ตรวจอีกครั้ง: ยังไม่ต้องแก้** `vitest.config.ts` เขียนว่า "Only `src/core/**` is unit tested"
ซึ่งยังจริง — decision ของ panel ไปอยู่ `core/panelFields.ts` ไม่ใช่ test ไฟล์ `ui.tsx`

**เพิ่ม QA step** `docs/qa-checklist.md` หัวข้อ "The connector panel's number fields" 7 ข้อ
เพราะพฤติกรรมเปลี่ยนจริงสามอย่าง (radius clamp, `minimum` หาย, ช่องว่างคืนค่าเดิม)

---

### B6 ✔️ ปิดแล้ว — ผ่า `connector.ts` (candidate 5)

> **ลงแล้วบน `b6/split-connector`:** `d2d3172` · `408e03b` · `3fb1cf5` · `7f36dde` · `4c6c196`
> `src/core/connector.ts` **1,654 → 929 บรรทัด** · เกิด 4 ไฟล์ใหม่
> test 357 → **368** · coverage `src/core/**` **92.16 → 95.74% stmts · 88.71 → 93.89% branch**
> router เอง **82.84 → 93.42% branch**

**สี่คัตที่ทำจริง**

| ไฟล์ | บรรทัด | ถืออะไร |
|:--|--:|:--|
| `connector.ts` | 929 | elbow router + A\* fallback — "เส้นไปทางไหน" |
| `connectorRecord.ts` | 330 | connector *คืออะไร* — record, style, default, การ decode |
| `routeCost.ts` | 182 | route ถูกตัดสินด้วยอะไร — obstacle vocabulary + การให้คะแนน |
| `manualShape.ts` | 172 | เส้นที่คนปรับเอง (ปลั๊กอินยกให้คนตัดสิน) |
| `connectorCurve.ts` | 120 | เส้นโค้ง + อ่านจุดบน route เพื่อวางป้าย |

**✅ บททดสอบที่เอกสารตั้งไว้เอง — ผ่าน** `ELBOW_STUB` เคยถูกอ้างจาก 3 concern ที่ไม่เกี่ยวกัน
วันนี้เป็น **internal ของไฟล์เดียว** ไม่ต้อง export ข้ามไฟล์เลย แปลว่าเส้นแบ่งตกถูกที่

**🆕 ผลพลอยได้ที่ใหญ่กว่าที่คิด: เลข coverage เดิมโกหก**

`connector.ts` 82.84% branch เป็นเหตุผลหนึ่งที่ B6 ถูก justify — พอแยกแล้วเห็นว่า
`connectorRecord.ts` อยู่ที่ **100% ทั้งสองตัว** ส่วน router ต่างหากที่ต่ำจริง
เลขเดิมคือ**ค่าเฉลี่ยที่ซ่อนว่าครึ่งไหนไม่ได้ถูกทดสอบ** → ตามอุดด้วย test 4 ตัวใน `4c6c196`
(กฎ pin ทั้ง 4 ทิศ · pin ที่ไม่มีอะไรให้ทำ · board ที่แน่นเกิน `MAX_MEASURED_NEIGHBOURS`)

**🆕 แก้ backwards dependency 2 จุดที่เอกสารไม่เห็น**

- `drawnShape.ts` import `ManualVertex` จาก `connector.ts` — module เล็กดึงไฟล์ 1,650 บรรทัด
  มาเพื่อตั้งชื่อ type เดียว
- `obstacleScan.ts` import `RouteObstacles` · `ROUTE_SEARCH_MARGIN` · `obstaclesInPlay` จาก router

ทั้งสองหายไปแล้ว — ตอนนี้ไม่มี core module ไหน import router เพื่อเอาของที่ router ไม่ได้เป็นเจ้าของ

**❌ ลำดับที่เอกสารเสนอไม่รอดการวัด** เอกสารเสนอ manual shape → **A\* search** → record → geometry
วัดแล้ว search ตัดออกไม่คุ้ม:

- `simplifyRoute` ถูก router เรียก **6 ครั้ง** และ search เรียก 1 ครั้ง — เป็นเครื่องมือของ router
  ยก search ออกต้องลาก `simplifyRoute` ไปอยู่ module ที่ตั้งขึ้นมาเพื่อการนี้โดยเฉพาะ
- search คือ**ทางยอมแพ้ของ router เอง** (ADR 0004 "search for a route when the rules run out")
  ต่อกันที่ `orSearched` บรรทัดเดียว ไม่ใช่ concern แยก

จึงตัด **record + curve + routeCost** แทน ซึ่งเอกสารจัดไว้ทีหลังหรือไม่ได้พูดถึง
ผลลัพธ์ 929 บรรทัด ใกล้เป้า ~750 ที่เอกสารตั้งไว้ และ search เป็น 130 ของมัน

**❌ `edgesOn` — เอกสารเข้าใจผิด** เอกสารบอกว่า `edgesOn` seed ให้ search
ตรวจแล้ว `gridLines` สร้าง grid ของตัวเองจาก `OBSTACLE_CLEARANCE` · `edgesOn` ถูกเรียกจาก
`sameAxisCandidates` (elbow router) เท่านั้น

---

### B7 ✔️ ปิดแล้ว — message contract เป็น union + ช่องบอกความล้มเหลว (candidate 7)

> **ลงแล้วบน `sundayfifth/feat-connector-drag-handles`:** `8e35eeb` (union + exhaustive
> registration) · `f51e6c6` (`COMMAND_FAILED`)
> `src/messages.ts` **179 → 194 บรรทัด** แต่ `export interface` 26 → **13 payload + 2 map**
> (handler 13 ตัวกลายเป็น type alias บรรทัดเดียวที่ derive จาก map)

**ส่วนที่ 1 — เพิ่ม message แล้วลืม `on()` ต้อง compile ไม่ผ่าน** `UiToMain` / `MainToUi`
map ชื่อ message → payload ที่มันแบก แล้ว `main.ts` ลงทะเบียนจาก object ที่ type เป็น
`UiToMain` ทั้งก้อน (`{ [Name in keyof UiToMain]: (payload: UiToMain[Name]) => void }`)
แล้ววน `Object.keys` ลงทะเบียน — ชื่อ message จึงอยู่ที่เดียว

**ยืนยันว่า bite จริง** เพิ่ม `TOGGLE_SOMETHING` เข้า `UiToMain` โดยไม่ใส่ handler →
`error TS2741: Property 'TOGGLE_SOMETHING' is missing` ไม่ใช่แค่ "ควรจะจับได้"

**🆕 เจอตอนทำ: `ADD_CATEGORY` ไม่ได้ queue และนั่นถูกแล้ว** เอกสารเดิมไม่ได้พูดถึง
ตรวจแล้ว `addCategory` sync ตั้งแต่ read ถึง write ไม่มี `await` ให้ command ที่สองแทรก
จึงไม่มีอะไรต้อง serialise — ต่างจากอีก 3 category command ที่ work เป็น async
เขียนเหตุผลไว้ในโค้ดแล้ว (ก่อนหน้านี้ไม่มีอะไรบอกว่าเป็นการตัดสินใจหรือการหลงลืม)

**ส่วนที่ 2 — `COMMAND_FAILED`** `commandFailed(command, reason)` = `figma.notify` (ทางที่
plugin นี้ใช้บอก sync ล้มเหลวอยู่แล้ว) + ส่ง `COMMAND_FAILED` ให้ panel + re-emit selection

**⚠️ ข้อที่สำคัญและเกือบตัดออกไป: ส่ง message ให้ UI ไม่ซ้ำซ้อนกับการ re-emit selection**
`useAdoptedFromOutside` (`ui.tsx`) รับค่าที่**เปลี่ยน**จากที่อื่นเท่านั้น — เทียบ incoming กับ
ค่าที่เห็นล่าสุด พอ command ถูกปฏิเสธ record ไม่เปลี่ยน `incoming` จึงเท่าเดิม และเลขที่คนพิมพ์
ค้างอยู่ในช่องเหมือนถูกบันทึกแล้ว การ re-emit selection แก้ไม่ได้ · panel จึงนับจำนวนครั้งที่ถูก
ปฏิเสธเข้าไปใน `key` ของ editor → reset ทุกช่องกลับเป็นค่าที่เก็บจริง ซึ่งเป็นการ reset
ที่ถูกขนาดในกรณีนี้ ต่างจาก remount ที่ A3 เอาออก เพราะ "ถูกปฏิเสธ" หมายความว่าไม่มีอะไร
ที่พิมพ์ไว้ถูกบันทึกเลย ไม่มีงานที่ยังไม่ save ให้ต้องรักษา

**⚠️ เห็นต่างกับเอกสารเดิมหนึ่งข้อ** เอกสารเดิมอ้าง `ui.tsx:1047-1053` (guard ชื่อ category ว่าง)
เป็นหลักฐานว่า "UI ต้องเขียนโค้ดชดเชยพฤติกรรมของอีกฝั่งที่มันมองไม่เห็น" — **ครึ่งเดียวถูก**
guard นั้นคงไว้โดยตั้งใจ: ชื่อว่างเป็นกฎที่ panel ตัดสินเองได้ ไม่ต้อง round trip และไม่ส่งของ
ที่ยังไงก็ไม่ถูกบันทึก · main รายงานด้วยเผื่อมีทางอื่นไปถึง — คอมเมนต์ในโค้ดแก้ให้ตรงแล้ว

**สโคปที่ยังไม่ครอบ — พูดตรงๆ** ที่ปิดคือ guard ของ `main.ts` เอง ส่วน scene layer มี
silent return ของตัวเองอีกชั้น (`updateConnectorStyle` บน node ที่ record ถูกลบไปแล้ว เป็นต้น
— `grep -c '=== null) return'` = 10 ใน `connectorScene.ts`, 7 ใน `annotationScene.ts`)
ซึ่งต้องแก้ให้ function พวกนั้นรายงานกลับ = งานแยกที่แตะไฟล์ร้อนสองไฟล์อีกรอบ

**test ไม่ได้ → เพิ่ม QA step** `docs/qa-checklist.md` หัวข้อ "A command that cannot be applied"
5 ข้อ

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

### V3 ✔️ ปิดแล้ว — export ที่ไม่มีใครนอกไฟล์ใช้

`FRAME_CLEARANCE_MARGIN` (`connector.ts:1205`) · `ConnectorCurve` (`:1558`) และอีก 7 type
ในไฟล์อื่น — `annotation.ts` 3 · `drawnShape.ts` 3 · `anchor.ts` 1 (ดูตาราง B1) — รวมอยู่ใน B1 แล้ว ไม่ใช่งานแยก

---

## 5. test + config

| # | ข้อ | หลักฐาน | ทำอะไร |
|:--|:--|:--|:--|
| T1 ✔️ | test วัดเวลาจริง flaky ได้บน CI ที่โหลดหนัก และวัดค่าจูน ไม่ใช่สัญญา | เดิม `expect(Date.now() - start).toBeLessThan(200)` | **ปิดแล้ว** — `grep -n 'Date.now()' test/*.ts` = 0 hit |
| T2 ✔️ | test ที่อาจรัน 0 assertion | `if (routerKeepsIt) expect(...)` ผ่านได้โดยไม่ assert อะไร | **ปิดแล้ว** — `expect.hasAssertions()` ที่ `test/connector.test.ts:1086` |
| T3 ✔️ | `coverage` text report ไม่แสดง `src/core/obstacleScan.ts` ทั้งที่มัน **100%** | text table แสดง 5 ไฟล์ · `json-summary` แสดง 6 ไฟล์ (`obstacleScan.ts` 31/31 stmts) · ลอง `--coverage.skipFull=false` แล้วยังไม่โชว์ · `--coverage.skipFull=true` ทำให้แถวหายทั้งตาราง (vitest 4.1.11) | **ปิดแล้ว** (`1cf6133`) — `vitest.config.ts:20` reporters เป็น `['text', 'html', 'json-summary']` · สาเหตุที่ text reporter กรองแถวยังไม่ยืนยัน **อย่าเชื่อ text table เป็นแหล่งเดียว** |
| T4 ❌ | คอมเมนต์หัวไฟล์ไม่ตรงกับความจริง | `vitest.config.ts:3-4` "Only `src/core/**` is unit tested: it is the one layer that never touches the `figma` global" | **ไม่ต้องแก้ — premise ผิด** เอกสารเดิมคิดว่า B4 จะทำให้ประโยคแรกไม่จริง เพราะจะไป test โค้ด scene แต่ B4 ที่ทำถูกคือย้ายกฎ*เข้า* core แล้ว test ที่นั่น ประโยคทั้งสองจึงยังจริงหลัง B4 ลง ตรวจแล้วบน `d7d19cd` |
| T5 ✔️ | ไม่มี lint plugin ของ Preact/React | ไฟล์ 1,315 บรรทัดที่มี 15 hook ไม่มีตาข่าย | **ปิดแล้ว** (`38d2353`) — `eslint.config.js:34-37` `rules-of-hooks: error` + `exhaustive-deps: warn` เป็นตาข่ายให้ B5 แล้ว |
| T6 ✔️ | `eslint` ใช้ `recommendedTypeChecked` | `eslint.config.js` | **ปิดแล้ว** (`ec977ef`) — ลอง `strictTypeChecked` แล้วได้ **50 error 3 กอง**: 22 `restrict-template-expressions` (ตั้งใจ ถูกแล้ว) · 12 `no-non-null-assertion` (อยู่ใน test) · 14 `no-unnecessary-condition` (**มีค่าจริง**) → เปิดเฉพาะกฎที่สาม ไม่เอา preset ทั้งชุด · 6 จุดที่เจอ: 1 ตายจริงจาก A2 ลบทิ้ง · 5 เป็น fallback ของ `absoluteTransform` เก็บไว้พร้อมเหตุผล เพราะกัน Figma ขัดกับ type ของตัวเอง ซึ่งทดสอบไม่ได้ — **ไม่แตะพฤติกรรมเลยสักบรรทัด** |
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
| 4 | ~~B4~~ ✔️ | เขียนตาข่าย `core/nodeTree.ts` + `polylineAtOrigin` — เป็นตาข่ายให้ B2 กับ B3 · T4 ตรวจแล้ว premise ผิด ไม่ต้องแก้ |
| 5 | ~~B2~~ ✔️ | ลงเป็น commit เดียว `8b4818c` · เจอ drift เพิ่มอีกสองจุดที่เอกสารเดิมไม่เห็น |
| ~~6~~ ✔️ | ~~B3~~ | หลัง B2 เท่านั้น ทั้งสองข้อเขียน write path ใหม่ทั้งคู่ · วัดก่อน (`320a357`) แล้วทำคนละทางกับที่เอกสารเสนอ (`be089c8`) — **ลบ** suppression ทิ้งทั้งกลไก ไม่ใช่เพิ่ม type ให้มัน |
| 7 | ~~B5 B7~~ ✔️ | ลงแล้วทั้งคู่ — B7 (`8e35eeb`, `f51e6c6`) · B5 (`b8c06b0`) |
| ~~8~~ ✔️ | ~~B6~~ | ทำท้ายสุดจริงตามข้อจำกัด — merge งานที่เหลือเข้า main ก่อน (PR #5) แล้วเปิด branch ใหม่จาก main ที่สดที่สุด ทำให้ B6 เป็น branch ที่มีเรื่องเดียว |

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
- ~~**ยก suppress flag รอบทุก write**~~ — **กฎนี้ไม่มีแล้ว** B3 ลบกลไกทิ้ง (`be089c8`)
  แทนที่ด้วย 3 กลไกอิงเนื้อหาที่เขียนไว้ใน `CLAUDE.md` · ถ้าเพิ่ม write ที่คนก็ทำเองได้
  ต้องผ่านหนึ่งในนั้น
- **commit เป็นก้าวเล็กที่ทำงานได้จริง**
- **รัน `npm run typecheck && npm test` หลังทุกการแก้ ก่อนรายงานว่าเสร็จ ทุกครั้ง ไม่ใช่เมื่อถูกขอ**

---

## 8. วิธี re-verify เอกสารนี้

เลขทุกตัวข้างบนมาจากคำสั่งพวกนี้ รันซ้ำได้เมื่อ main เดินไปแล้ว

**วัดว่า test จับ bug ได้จริงไหม (ใช้ใน B1 กับ B4)**

coverage บอกว่าโค้ดถูก*รัน* ไม่ได้บอกว่าถูก*ตรวจ* — `expect(x).toBe(DEFAULT)` ที่ import
ค่า default มาเป็นค่าที่คาดหวัง รัน 100% แล้วผ่านเสมอไม่ว่าค่านั้นจะถูกหรือผิด (ดู B1)
วิธีที่ใช้จริง: แก้กฎในโค้ดให้ผิดหนึ่งอย่าง แล้วดูว่า test แดง ถ้าไม่แดง = ตาข่ายมีรู

```sh
cp src/core/<ไฟล์>.ts /tmp/bak            # กลับคืนได้เสมอ
# แก้กฎให้ผิดหนึ่งอย่าง เช่น < เป็น <=, เอา guard ออก, เปลี่ยน min เป็น first
npx vitest run 2>&1 | grep -E 'Tests +[0-9]'
cp /tmp/bak src/core/<ไฟล์>.ts
```

ที่ B4 ทำแบบนี้ 9 mutation — แดง 8 เหลือรอด 1 (เอา guard `parent !== under.parent` ออก
ซึ่ง `indexOf` คืน `-1` ทำให้ตอบเหมือนกันพอดี) ตัวที่รอดแบบ**ไม่มี test ไหนแยกได้**
ให้เขียนเหตุผลไว้ในโค้ด ไม่ใช่ปล่อย test ที่แยกไม่ออกไว้ให้ดูเหมือนมีตาข่าย

```sh
# figma ref ต่อไฟล์ (core ต้องเป็น 0)
for f in src/core/*.ts src/scene/*.ts src/main.ts src/ui.tsx; do
  printf "%-40s %s\n" "$f" "$(grep -c 'figma\.' "$f")"
done

# mutating call ทั้งหมดใน scene + main
grep -n 'setPluginData\|\.remove()\|appendChild\|insertChild\|setVectorNetworkAsync' \
  src/scene/*.ts src/main.ts

# ต้องไม่เจออะไรเลย นอกจากบันทึกประวัติใน authorship.ts — กลไกถูกลบใน be089c8
grep -rn 'withSuppressedNodeChange\|isSuppressed' src/ --include='*.ts'

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
