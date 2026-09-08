# การ publish plugin ขึ้น Figma Community — สรุปข้อกำหนดจริง

**ข้อมูล ณ 2026-09-04** — อ้างอิงจาก primary source ของ Figma เท่านั้น
(help.figma.com, developers.figma.com, figma.com/legal) ทุกข้อมีลิงก์กำกับ
พร้อมวันที่ last-updated ที่หน้านั้นประกาศไว้

หมายเหตุเรื่อง URL: `figma.com/plugin-docs/*` ตอบ **301 redirect** ไปที่
`developers.figma.com/docs/plugins/*` แล้ว ลิงก์เก่าในโค้ด/บุ๊กมาร์กควรอัปเดต

**เวอร์ชันปัจจุบันของ Plugin API**: Version 1, Update 138 (2026-09-03) —
[Updates](https://developers.figma.com/docs/plugins/updates/)
`@figma/plugin-typings` บน npm ล่าสุดคือ `1.138.0` (publish 2026-09-03)
ซึ่งตรงกับที่ repo นี้ pin ไว้ (`^1.138.0`) — ถือว่า current

---

## 1. Submission flow

### ก่อนเริ่ม (prerequisites)

จาก [Publish classic plugins to the Figma Community](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community)
(last updated 2026-08-29):

- ต้องใช้ **Figma desktop app** บน macOS หรือ Windows เท่านั้น — publish จาก
  browser ไม่ได้
- ต้อง **Create a plugin for development** ก่อน
- ต้องเปิด **two-factor authentication**
- รองรับทุก plan ("Supported on any plan") — แต่ paid plugin ต้องเป็น approved creator
- ต้องมี **Community profile** ก่อน publish ได้
  ([Create a Community profile](https://help.figma.com/hc/en-us/articles/360038510833-Create-a-Community-profile),
  last updated 2026-07-20) — handle ยาวได้ไม่เกิน **15 ตัวอักษร** (alphanumeric + underscore)

### ใครมีสิทธิ publish (individual vs team vs org)

จาก [Community publishing permissions](https://help.figma.com/hc/en-us/articles/360041423614-Community-publishing-permissions)
(last updated 2026-09-03):

- **Personal profile** — ใครก็ได้ที่มี Figma account, 1 profile ต่อ 1 email
  แต่ถ้าคุณอยู่ใน organization: "any files or plugins you create in the organization
  belong to that organization" → **by default publish ของ org ขึ้น personal profile ไม่ได้**
  ทางออกคือย้ายไป non-organization team หรือ personal account หรือให้ org admin
  เปิด setting `Admin > Settings > Other > Community file publishing`
- **Team profile** — เฉพาะ team owner/admin, และไฟล์ต้องอยู่ใน team นั้น
- **Organization profile** — เฉพาะ **organization admin** เท่านั้น
- ตอน publish เลือกได้ว่าจะ publish เป็น "yourself, one of your teams, or your organization"

จาก [Create internal plugins for an organization](https://help.figma.com/hc/en-us/articles/4404228629655-Create-internal-plugins-for-an-organization)
(last updated 2026-09-01):

- "Any member of an organization can publish internal plugins to the organization"
- "Only organization admins can publish public plugins to an organization profile"

### ขั้นตอนจริงในตัว app

1. เปิด/สร้างไฟล์ใน Figma desktop app
2. คลิก logo Figma มุมซ้ายบน → **Plugins > Manage plugins**
3. คลิกที่ plugin → **Publish**
4. **Describe your resource** — name, tagline สั้น, description, เลือก category
   (ตัวอย่างที่ docs ยกมา: "Design tools" หรือ "Software development")
5. **Choose some images** — icon, thumbnail, playground file (optional),
   carousel media (optional)
6. **Data security** (optional) — กรอก security disclosure form
7. **Add the final details** — Publish to (Organization / Community),
   publisher, support contact, network access review, contributors,
   comment setting, pricing (ถ้าเป็น paid)
8. คลิก **Publish** เพื่อส่ง review

### Private vs public vs org-only

- ตัวเลือก `Publish to` โผล่เฉพาะ **Organization และ Enterprise plans**:
  - `Organization` = แชร์แบบ private ในองค์กร
  - `Community` = public
- **Internal/org plugin ไม่ต้องผ่าน review**: "Figma doesn't review any plugins
  you choose to share privately within an organization" และ "Internal plugins
  don't need to go through the review process before they are available to use"
- เปลี่ยนจาก private → public ได้ แต่ "If you're changing a plugin from private
  to public, it will need to go through Figma's plugin and widget review process"
  และ "Only the plugin's original publisher can change the plugin's access"
- **ถ้าไม่ได้อยู่บน Organization/Enterprise plan ก็ไม่มี org-only option** — เหลือแค่
  public Community หรือปล่อยเป็น local development plugin (import manifest เอง)

### Updates / เวอร์ชันใหม่

จาก [Manage classic plugins as a developer](https://help.figma.com/hc/en-us/articles/360042293714-Manage-classic-plugins-as-a-developer)
(last updated 2026-09-03):

- "Once Figma approves your plugin, you don't need to submit your plugin for
  further review. This means you can publish any updates immediately."
- Flow: Manage plugins → **Publish new version** (ถ้าไม่เห็นเมนูนี้ ให้ **Locate
  local version** ชี้ไปที่ `manifest.json` ก่อน)
- ใส่ **Release notes** ได้ในหน้า final details
- Update จะ push ให้ **ทุกคนที่ติดตั้งไว้ทันที** และ "It's not possible for users
  to revert to a previous version" — rollback ทำได้แค่ republish เวอร์ชันเก่า
- แก้หน้า Community page (title/description/artwork) ได้ตลอดโดยไม่ต้อง publish
  เวอร์ชันใหม่: `Manage resource > Edit this page`
- ยัง push update ได้ระหว่างอยู่ใน review

**ข้อควรระวัง — สองหน้านี้พูดไม่ตรงกันเป๊ะ:** [review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)
(last updated 2026-09-03) เขียนว่า "Any material updates to your plugin or widget
are subject to re-review in accordance with this process. If the core functionality
of your plugin or widget substantially changes, you should create a new, separate
plugin and submit it for review. Figma may also require periodic reviews" —
สรุปคือ update ปกติ publish ได้เลย แต่ Figma สงวนสิทธิ re-review ถ้าเป็นการ
เปลี่ยนแปลงสาระสำคัญ

### Unpublishing

- **Unpublish from Community page**: `Manage resource > Unpublish`
- **Unpublish จากในไฟล์**: Manage plugins → Unpublish
- ผล: "unpublishing your plugin will remove it for anyone who has installed it"
  และ user **ไม่ได้รับ notification** — Figma แนะนำให้แจ้งล่วงหน้าใน description เอง
- "likes and installs will be retained, but any details—such as title, tagline,
  description, and so on—will be lost"
- plugin จะยังอยู่ใน Development บน account ของเรา
- **Paid plugin unpublish ไม่ได้** — ทำได้แค่ delist
- **Remove (in development)** = ลบถาวร "It's not possible to restore a deleted
  plugin. Deleting a plugin will also remove any likes and installs you have
  acquired, even if you publish the same plugin in the future."
- ลบ Community profile = unpublish ของฟรีทั้งหมด + delist ของที่ขาย

### Ownership transfer

- โอน ownership ได้เฉพาะ **private organization plugins**:
  "You cannot transfer ownership of plugins published outside of an organization"
- ห้ามแชร์ account/password หรือขายโอน plugin โดยไม่ได้รับอนุมัติจาก Figma

---

## 2. Assets และ metadata ที่ต้องเตรียม

ตัวเลขทั้งหมดจาก [Publish classic plugins](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community)
(2026-08-29) และ [Grow your audience on Community](https://help.figma.com/hc/en-us/articles/22166943560983-Grow-your-audience-on-Community)
(last updated 2026-06-27)

| สิ่งที่ต้องมี | ข้อกำหนด | บังคับ? |
|---|---|---|
| **Icon** | "recommended size **128 x 128px**" | ต้องมี |
| **Thumbnail / cover art** | image หรือ video, "recommended size **1920 x 1080px**" — ใน Figma Design ใช้ preset **Community file cover** frame ได้ | ต้องมี |
| **Carousel** | image/video ได้ **ไม่เกิน 9 ชิ้น** (หน้า Grow your audience เขียนว่า "up to 10 supporting image previews" — ตัวเลขสองหน้าไม่ตรงกัน, publishing doc ที่ใหม่กว่าบอก 9), ขนาด 1920 x 1080 px, plugin/widget ใส่ video สั้นได้ | optional |
| **Playground file** | ไฟล์ให้คนลองเล่น plugin | optional |
| **Name** | ต้องมี | ต้องมี |
| **Tagline** | "short tagline that describes the plugin" | ต้องมี |
| **Description** | rich text (heading, bullet ได้) — แนะนำใส่ setup/usage instructions + change log | ต้องมี |
| **Category** | เลือก category (+ subcategory) เช่น Design tools, Software development, Data visualization, Prototyping & animation, Visual assets | ต้องมี |
| **Tags** | "up to **five tags**" custom tag ยาวไม่เกิน **25 characters** | optional |
| **Support contact** | email หรือ link ไป website/help center — "You need to add a Support contact when you submit your plugin for approval" | **ต้องมี** |
| **Contributors** | เพิ่ม co-creator ได้ | optional |
| **Comments** | เปิด/ปิด comment จาก Community | optional |
| **Security disclosure** | form ตอบคำถาม data security | optional (แต่ Figma "encourage") |

**ไม่มีข้อกำหนดว่าต้องมี format ไฟล์รูปแบบไหน (PNG/JPG/…) หรือขนาดไฟล์สูงสุดกี่ MB
ระบุไว้ใน docs** — Figma ใช้คำว่า "recommended size" ไม่ใช่ required

### Name rules / branding

จาก [Figma Community Guidelines](https://help.figma.com/hc/en-us/articles/360038510573-Figma-Community-Guidelines)
(หน้า updated 2026-09-01, เอกสารเองระบุ "Last Updated: February 1, 2024"):

> **Allowed:** You can refer to Figma or our products in your resource's title.
> For example: Tom's plugin for Figma Design
>
> **Not allowed:** Don't include our name (or part of our name) in your company
> name, resource names, domain name, or social media handle. For example: Figdesigns

review guidelines ย้ำ: "If you are using Figma's brand, you are required to review
and comply with the [Figma trademark guidelines](https://www.figma.com/legal/trademarks/)"

### Manifest / code requirements

จาก [Plugin Manifest](https://developers.figma.com/docs/plugins/manifest/):

- **required**: `name`, `id`, `api`, `main`, `editorType`
- **`id`** — "The plugin ID to publish updates to. This ID will be assigned to you
  by Figma and is typically obtained using the 'Create new Plugin' feature"
  (หรือได้ตอน publish ครั้งแรก) → **id ที่เราตั้งเองไม่ใช่ id จริง**
- **`editorType`** ค่าที่รองรับ: `"figma"`, `"figjam"`, `"dev"`, `"slides"`, `"buzz"`
  (`["figjam", "dev"]` ไม่รองรับ) — **ไม่มี** editorType สำหรับ Figma Make
- **`documentAccess`** — "This field ensures the plugin supports dynamic page
  loading. **The field is required for all new plugins and the value must be
  `dynamic-page`**"
- **`networkAccess`** — `allowedDomains` เป็น required array; `reasoning` เป็น
  required ถ้าใช้ `"*"` หรือ local/dev server; `["none"]` = block external ทั้งหมด
- **`permissions`** ที่มีให้เลือก: `currentuser`, `activeusers`, `fileusers`,
  `payments`, `teamlibrary`
- ต้องใช้ official API เท่านั้น: "Plugins and widgets can only leverage official
  plugin APIs or widget APIs provided by Figma and cannot require users to install
  separate packages that manipulate Figma on the Web or the Desktop App"
- **ไม่มีข้อกำหนดว่าต้องส่ง source code หรือ open-source** — Figma รับ bundle
  ที่ build แล้ว
- **ไม่มี hard limit ของขนาด bundle ระบุใน docs** — มีแต่คำแนะนำเรื่อง performance

### networkAccess label ที่ reviewer เห็น

ตอน publish Figma แสดง label ตาม manifest:

- **Unknown network access** — ไม่ได้ define ใน `manifest.json`
- **Unrestricted network access** — เข้าถึงได้ทุก domain
- **Restricted network access** — เฉพาะ domain ที่ระบุ
- **No access to network** — เข้าถึง domain ไม่ได้เลย ← กรณีของ `["none"]`

review guidelines: "Developers are encouraged to specify the network access of
their plugins and widgets"

---

## 3. Review process

### ใช้เวลานานเท่าไหร่

- [Publish classic plugins](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community)
  และ [review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)
  ใช้ถ้อยคำเดียวกัน: "Our goal is to be thoughtful and reasonably prompt in our
  review. **Approval times vary depending on current volume and the team's
  availability.**"
- **Figma เลิกระบุ SLA เป็นตัวเลขแล้ว** — ตัวเลข "up to two weeks" ที่ยังอยู่ในหน้า
  publishing หมายถึง **security disclosure form** ไม่ใช่ตัว plugin review:
  "Review and approval may take up to two weeks. When the disclosure form is
  approved by Figma, your answers are visible to logged-in users"
- ระหว่าง review plugin ติด badge **In review**; approve แล้วเป็น **Published**
- แจ้งผลทาง **Figma account email**; ถ้า reject แก้แล้วส่งใหม่ได้

### Review guidelines ฉบับเต็ม 4 หมวด

[Plugin and widget review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines)
— **last updated 2026-09-03** (edited 2026-09-01) หน้านี้ขึ้นคำเตือนว่า
"This is an evolving document, so its contents may change over time"

หมายเหตุใหม่ที่เพิ่มเข้ามา: "In these guidelines, 'plugin' includes both **classic
plugins and generative plugins** unless we say otherwise"

**1. Quality and Usability** — completeness (reject ถ้า crash หรือมี obvious bug,
ห้ามมี temporary content, ห้ามใช้ developer error message สื่อสารกับ end-user),
accurate descriptions (ต้องมี doc อธิบายวิธี setup/ใช้), design (แนะนำให้ match
Figma UI), performance ("An example of this would be a long-running background
process") และต้องแจ้ง user เมื่อ offline

**2. Trust and Safety** — objectionable content; security ("we may reject plugins
or widgets that read or modify a Figma file without a user's explicit awareness
and consent"); API usage; account requirements; external connections ต้องชัดเจน

**3. Business** — ข้อที่เกี่ยวกับเราตรงที่สุด (ยกมาเต็ม):

> - The purpose of Figma Community is to enable sharing of plugins and widgets
>   with all Figma Community users – not for publishing plugins/widget that are
>   meant to be used only by an internal team.
> - If you want to publish a plugin or widget that is meant to be used privately
>   within a team or small group of users, then you should publish a plugin or
>   widget privately to your organization.
> - If a plugin or widget has the same essential functionality as an existing
>   plugin or widget you've published previously, it should share the same listing.
> - We allow plugins and widgets to direct users to a third party to allow for
>   monetization, but we reserve the right to reject plugins and widgets that
>   attempt to monetize in poor taste.
> - **We may not approve plugins or widgets that recreate Figma functionality,
>   including the core capabilities of Figma products such as the Figma agent
>   and the Figma MCP server.**
> - We may not approve plugins or widgets that function as a workaround to Figma's
>   paid offerings.

**AI functionality** (ย่อหน้าใหม่ปี 2026, ยกมาเต็ม):

> Figma provides AI capabilities through the Figma agent, our Model Context
> Protocol (MCP) server, and other features across the platform. We encourage the
> Community to create AI plugins and widgets that extend and complement Figma's
> native capabilities. We generally do not approve plugins or widgets that overlap
> with Figma's AI capabilities and paid offerings, including those that:
> - Provide a general-purpose AI chat interface in Figma, including plugins or
>   widgets that allow users to bring their own API key for other model providers.
> - Expose an MCP server through a plugin, or otherwise provide programmatic AI
>   access to Figma files outside our official MCP server.

**Advertisements** — "Plugins and widgets may not display ads to Figma users.
Please do not insert advertisements into design files or present ads in the plugin
UI or widget UI."

**4. Legal** — ต้องอ่านและปฏิบัติตาม
[Developer Terms](https://www.figma.com/developer-terms/),
[Creator Agreement](https://www.figma.com/legal/creator-agreement/),
[Licensing Terms](https://www.figma.com/legal/community-licensing/),
[Community Terms](https://www.figma.com/legal/community-terms/)
และ:

> Also, please remember, **if your plugin or widget processes user data, you must
> provide and maintain a privacy policy that satisfies applicable legal standards.**

### Privacy policy — ต้องมีเมื่อไหร่

- review guidelines: บังคับ "if your plugin or widget **processes user data**"
- [About selling Community resources](https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources)
  (last updated 2026-09-03) เขียนละเอียดกว่า และเป็นเกณฑ์ที่ชัดที่สุด:
  "If your resource **processes or stores customer data outside the customer's
  file**, you must provide and maintain a publicly available privacy policy that
  satisfies applicable legal standards and covers how you collect, use, store, and
  share data in accurate and understandable terms."
- Figma ยังบอกให้ "Consulted legal counsel to understand your legal obligations,
  and prepare necessary documents (like a privacy policy)"

→ **ถ้า plugin ไม่ส่งข้อมูลออกนอกไฟล์เลย (networkAccess none, เก็บใน pluginData
เท่านั้น) ตามตัวหนังสือคือไม่เข้าเกณฑ์บังคับ privacy policy** แต่ Figma ไม่ได้เขียน
exemption ไว้ตรง ๆ — จุดนี้ **ไม่ได้ระบุชัดใน docs**

### Security disclosure program

[Security disclosure principles](https://help.figma.com/hc/en-us/articles/16354660649495-Security-disclosure-principles)
(last updated 2026-08-04) — **ยังเป็น "open beta"** เป็นการกรอกแบบ **สมัครใจ**
ใช้เวลาอนุมัติได้ถึง 2 สัปดาห์ คำถาม 5 ข้อ (backend service, network requests,
user authentication, การเก็บข้อมูลจาก Figma API, การจัดการ update)
"passing criteria" ในอุดมคติคือ: ไม่มี external backend, ไม่ยิง network request,
ไม่เก็บ data ที่ได้จาก Figma API ออกนอก Figma — plugin ที่ networkAccess เป็น
`none` จะตอบผ่านทุกข้อโดยธรรมชาติ

### Common rejection reasons (ตามที่ guidelines ระบุเอง)

1. crash / มี obvious bug / มี temporary content
2. description ไม่ตรงกับที่ทำจริง หรือมี hidden functionality
3. usability แย่ / ไม่ match Figma UI
4. กระทบ performance ของ Figma (เช่น long-running background process)
5. อ่าน/แก้ไฟล์โดยที่ user ไม่รู้และไม่ยินยอม
6. ใช้ API นอก official API หรือให้ user ติดตั้ง package แยก
7. ไม่มี support contact / ข้อมูลติดต่อไม่ถูกต้อง
8. เป็นเครื่องมือสำหรับ internal team เท่านั้น (ควร publish private แทน)
9. ซ้ำกับ plugin ที่ตัวเองเคย publish ไว้ (ต้องรวม listing)
10. recreate Figma functionality / workaround ของ paid offering
11. AI chat interface ทั่วไป / expose MCP server
12. มีโฆษณาใน UI

---

## 4. Monetization

จาก [About selling Community resources](https://help.figma.com/hc/en-us/articles/12067637274519-About-selling-Community-resources)
(last updated 2026-09-03)

### สถานะ — ไม่ใช่ beta แล้ว แต่ยัง gate ด้วย approval

- **paid plugin เปิดรับ**: ต้อง "approved creator" + activate **Stripe** account ก่อน
- **paid files ปิดรับ creator ใหม่**: "We are not approving new creators to sell
  paid **files** on Community at this time" — ข้อความนี้จำกัดที่ files, ไม่ครอบ
  plugins/widgets
- docs ไม่ใช้คำว่า beta กับ payments แล้ว → ถือว่า GA สำหรับ approved creator
- **Payments API ไม่ได้ระบุสถานะ beta/GA ตรง ๆ ใน docs** ที่
  [Requiring Payment](https://developers.figma.com/docs/plugins/requiring-payment/)

### Pricing model

| | Plugins | Widgets | Files |
|---|---|---|---|
| One-time | ได้ | ได้ | ได้ |
| Subscription (monthly) | ได้ | ไม่ | ไม่ |
| ราคาต่ำสุด | **$2.00** USD | $2.00 | $2.00 |
| ต้องเป็นจำนวนเต็ม | ใช่ | ใช่ | ใช่ |

- one-time: เปลี่ยนราคาได้ตลอด
- subscription: ขึ้นราคาได้ **ครั้งเดียวต่อ 30 วัน** และ **ไม่เกิน 50% ต่อครั้ง**;
  แจ้ง user ล่วงหน้า 16 วัน
- yearly discount **1–95%** เปิด/ปิดได้ตลอด
- subscription plugin มี **free trial 7 วัน** by default; one-time ไม่มี
- **เลือกโมเดลแล้วเปลี่ยนไม่ได้** และ "After a plugin has been published as paid,
  it cannot be converted to free at a later date"

### Revenue share

> "When you make a sale on the Community, Figma collects a **flat 15% fee** to
> cover transactional and operational costs."

- cash out ได้ 30 US business days หลังการขาย, ไม่เกิน 1 ครั้ง/สัปดาห์
- Figma เก็บและนำส่ง sales tax ให้ (marketplace facilitator)
- non-US creator ต้องส่ง **W-8BEN** / W-8BEN-E ไปที่ ap@figma.com
- **ไม่รองรับ split payout** — มี designated payee คนเดียว เปลี่ยนไม่ได้
- **ขายจาก team/org profile ไม่ได้** — "Paid resources can only be published from
  individual accounts that have been approved to sell on Community"

### ประเทศที่รองรับ payout

รายการมี **Thailand** อยู่ด้วย (พร้อม Singapore, Malaysia, Vietnam, Indonesia,
Philippines, Japan, South Korea, Hong Kong, Macao ในภูมิภาคเดียวกัน)

### Licensing / entitlement API

จาก [Requiring Payment](https://developers.figma.com/docs/plugins/requiring-payment/)
และ [figma.payments](https://developers.figma.com/docs/plugins/api/figma-payments/):

- ต้องใส่ `"payments"` ใน `permissions` ของ manifest ไม่งั้น "Payments API methods
  will throw errors when called"
- API หลัก: `figma.payments.status.type` (`"PAID"` / `"UNPAID"`),
  `figma.payments.getUserFirstRanSecondsAgo()`,
  `figma.payments.initiateCheckoutAsync()`
- ใช้ทำ time-based / usage-based free trial เองได้ แต่ "must include information
  in the resource's description that clearly explains what's included in the trial"
- มี [Payments REST API](https://developers.figma.com/docs/rest-api/payments/)
  สำหรับ validate purchase จาก server
- ย้าย feature ที่ publish ฟรีไปแล้วไปหลัง paywall ได้ "However, the plugin or
  widget must still contain **free features in addition to paid**"
- purchase ผูกกับ account ที่ซื้อ — ใช้ข้าม connected account ไม่ได้,
  admin ซื้อให้สมาชิกทีมไม่ได้
- refund: อัตโนมัติภายใน 24 ชม. สำหรับ one-time; subscription ไม่ refund
- paid resource **unpublish ไม่ได้** ทำได้แค่
  [delist](https://help.figma.com/hc/en-us/articles/12843697930519-Delist-paid-resources)
  (คนที่ซื้อไปแล้วยังใช้ได้ต่อ)

### ถ้าจะ list แบบฟรีเท่านั้น

ต้องการอะไรเพิ่มเป็นพิเศษ: **ไม่มี** — ไม่ต้องสมัคร creator, ไม่ต้อง Stripe,
ไม่ต้องมี pricing, ไม่ต้องเปิด `payments` permission
มีแต่ข้อควรรู้ว่า licensing ของ free resource ต่างจาก paid
([Community copyright and licensing](https://www.figma.com/legal/community-licensing/))
และขายทีหลังจาก listing ฟรีเดิมได้เฉพาะ plugin/widget (ไม่ใช่ file)
แต่ต้องคงฟีเจอร์ฟรีไว้ด้วย

Figma ยังอนุญาตให้ขายผ่านช่องทางอื่น: "You can choose to sell your resource using
Figma's payment platform or a third-party payment site" — แต่ business guideline
สงวนสิทธิ reject "plugins and widgets that attempt to monetize in poor taste"

---

## 5. อะไรเปลี่ยนในปี 2025–2026

### Config 2026 (24 มิถุนายน 2026)

[What's new from Config 2026](https://help.figma.com/hc/en-us/articles/39582753756695-What-s-new-from-Config-2026)
(last updated 2026-09-04):

- **Generative plugins** — plugin ประเภทใหม่ที่ build ด้วยการ prompt Figma agent
  ในไฟล์ design ตรง ๆ ไม่ต้องมี dev environment
- **Figma Motion** (open beta) — animation/keyframe บน canvas
- **Custom shader effects and fills** (open beta) — WebGPU shader
- **Weave tools in Figma Design** (open beta) + **Weave workflows on Community** (GA)
- **Figma agent in design files** (open beta) — custom skills
- **Code layers** (closed beta)

### เอกสารแยกเป็น "classic" vs "generative" plugin

หน้า help center ถูก **rename** ทั้งชุดในปี 2026:

- "Publish plugins to the Figma Community" → "**Publish classic plugins** to the
  Figma Community" (updated 2026-08-29)
- "Make plugins for the Figma Community" → "**Build classic plugins** for the Figma
  Community" (updated 2026-08-29)
- "Manage plugins as a developer" → "**Manage classic plugins** as a developer"
  (updated 2026-09-03)
- ของใหม่: [Publish generative plugins](https://help.figma.com/hc/en-us/articles/43029200314135-Publish-generative-plugins-to-the-Figma-Community)
  (updated 2026-09-01), [About building plugins in Figma](https://help.figma.com/hc/en-us/articles/41407987481879-About-building-plugins-in-Figma)
  (updated 2026-09-01)

→ **ANNOCON คือ classic plugin** ต้องอ่านชุด "classic" ไม่ใช่ "generative"
สิ่งที่ต่างกันที่เห็นได้: generative plugin publish ผ่าน **Tools tab** ในไฟล์
(ไม่ใช่ Manage plugins) และมีช่อง **tags** (up to 5) ให้ในหน้า publish โดยตรง
ซึ่งหน้า classic ไม่ได้ระบุไว้

### Review guidelines ถูกแก้ล่าสุด 2026-09-03

สิ่งที่เพิ่มเข้ามาในรอบนี้ (เทียบกับข้อความรุ่นก่อน ๆ ที่พูดถึงแต่ "Figma AI"):

- ขยายนิยาม "plugin" ให้รวม generative plugin
- ระบุชื่อ **Figma agent** และ **Figma MCP server** เป็นตัวอย่างของ "core
  capabilities of Figma products" ที่ห้าม recreate
- เพิ่มข้อห้ามชัดเจน: general-purpose AI chat interface (รวมกรณี BYO API key)
  และ expose MCP server ผ่าน plugin
- เพิ่ม "We may not approve plugins or widgets that function as a workaround to
  Figma's paid offerings"

### Plugin API / manifest

- **`documentAccess: "dynamic-page"` เป็นข้อบังคับสำหรับ plugin ใหม่ทุกตัว** —
  [manifest doc](https://developers.figma.com/docs/plugins/manifest/) ระบุ
  "The field is required for all new plugins and the value must be `dynamic-page`"
  ผลข้างเคียงที่ต้องรู้: `documentchange` ใช้ไม่ได้จนกว่าจะเรียก
  `figma.loadAllPagesAsync()` (แนะนำใช้ `nodechange`/`stylechange` แทน) และ
  method บางตัวจะ throw — ตรงกับ development rules ใน `CLAUDE.md` ของเราแล้ว
- **`editorType` ที่รองรับปัจจุบัน**: `figma`, `figjam`, `dev`, `slides`, `buzz`
  — **ยังไม่มี editorType สำหรับ Figma Make** และ `["figjam", "dev"]` ยังไม่รองรับ
- **Plugin API updates ปี 2026 ที่ผ่านมา** (จาก [Updates](https://developers.figma.com/docs/plugins/updates/)):
  Update 130 (2026-06-23) motion + shader support; 131 (2026-07-16) video export
  via `exportAsync()`; 132 (2026-07-29) `figma.motion.playheadPosition`;
  133 (2026-08-05) `"EASING"`/`"TIMING"` variable types; 134 (2026-08-14)
  `textWrapStyle`; 136 (2026-08-27) `getCSSAsync` กลับมาใน public typings;
  137 (2026-08-31) `SPACE_EVENLY`/`SPACE_AROUND`; 138 (2026-09-03) variable fonts
  — **ไม่มี update ไหนในชุดนี้เปลี่ยนข้อกำหนดการ publish**
- Slots GA (2026-06-10)

### Community platform

- Community มี resource type ใหม่: **Apps** (มี
  [App review guidelines](https://help.figma.com/hc/en-us/articles/34963247780247-App-review-guidelines)
  แยกจาก plugin), **Figma Make projects**, **Weave workflow templates**,
  **Community riffs** — [Guide to the Figma Community](https://help.figma.com/hc/en-us/articles/360038510693-Guide-to-the-Figma-Community)
  (updated 2026-08-13)
- ซื้อ resource ตรงจาก Community ได้แล้ว
- `figma.com/plugin-docs/*` → 301 ไป `developers.figma.com/docs/plugins/*`

### Deprecation ที่กระทบการ list วันนี้

- **ไม่พบ deprecation ที่บล็อกการ publish** สำหรับ plugin ที่ manifest ถูกต้องอยู่แล้ว
  ข้อเดียวที่เป็น hard requirement คือ `documentAccess: "dynamic-page"`
  ซึ่ง repo นี้ผ่านอยู่แล้ว
- **Security disclosure program ยังเป็น open beta** (2026-08-04) — ยังสมัครใจ

---

## สิ่งที่ ANNOCON ต้องทำ / ต้องตัดสินใจก่อน publish

### สภาพปัจจุบันของ repo (`package.json` → `figma-plugin`)

```
id: "annotate-connect-dev"       name: "ANNOCON"
editorType: ["figma"]            documentAccess: "dynamic-page"
networkAccess: { allowedDomains: ["none"] }
package: private: true, license: "UNLICENSED", version 0.4.0
@figma/plugin-typings: ^1.138.0  (= ล่าสุด)
```

### ผ่านอยู่แล้ว ไม่ต้องแก้

- `documentAccess: "dynamic-page"` ✅ ตรงกับ hard requirement
- `editorType: ["figma"]` ✅ เป็นค่าที่รองรับ
- `networkAccess: ["none"]` ✅ จะได้ label **"No access to network"** ซึ่งเป็น
  ตำแหน่งที่ดีที่สุดในสายตา reviewer และตอบ security disclosure ผ่านทุกข้อ
  โดยไม่ต้องอธิบายอะไร
- ชื่อ **"ANNOCON"** ✅ ไม่มีคำว่า Figma หรือส่วนของชื่อ Figma — ไม่ชน
  Community Guidelines เรื่อง trademark
  (ถ้าอยากใส่ในชื่อ ทำได้แบบ "ANNOCON for Figma Design" แต่ **ห้าม** ชื่อแนว "Figcon")
- ใช้ official Plugin API เท่านั้น, ไม่มี background process, ไม่มีโฆษณา, ไม่มี AI ✅

### ต้องแก้ / ต้องเตรียม

| # | เรื่อง | รายละเอียด |
|---|---|---|
| 1 | **`id`** | `annotate-connect-dev` ไม่ใช่ id จริง — Figma จะ assign ให้ตอน "Create new Plugin" หรือตอน publish ครั้งแรก ต้องเอา id นั้นมาใส่ใน `figma-plugin.id` แล้ว build ใหม่ (create-figma-plugin regenerate `manifest.json` ทุกครั้งที่ build จึงต้องแก้ที่ `package.json` ไม่ใช่ที่ manifest) |
| 2 | **`private: true` + `license: UNLICENSED`** | เป็น field ของ npm ไม่มีผลกับ Figma review — Figma ไม่ขอ source code และไม่บังคับ open source แต่ถ้าจะ list public ควรทบทวนว่าอยาก keep UNLICENSED ไว้ไหม เพราะ [Community licensing](https://www.figma.com/legal/community-licensing/) มีเงื่อนไขของตัวเองสำหรับ free resource |
| 3 | **Support contact** | **บังคับ** — ยังไม่มี ต้องเตรียม email หรือหน้า help/GitHub issues ก่อนกดส่ง และตาม guidelines "It's your responsibility to provide support" |
| 4 | **Assets** | ยังไม่มี — icon 128×128, thumbnail 1920×1080, carousel ได้ถึง 9 ชิ้น (มีของใน `docs/media/` อยู่บ้าง อาจ reuse ได้), playground file ที่โชว์ทั้ง annotate และ connect จะช่วยมากเพราะ guidelines ระบุว่า "Playground files can be especially helpful for demonstrating how plugins or widgets are used on specific layers" |
| 5 | **Description** | ต้องพูดข้อจำกัดตรง ๆ ตามที่ `CLAUDE.md` กำหนดไว้แล้ว — connector re-route สดเฉพาะตอน plugin เปิด, มี reconciliation ตอนเปิด + re-sync command — ซึ่ง**สอดคล้อง**กับ guideline "Your plugin or widget should operate as described… so that the users will not be surprised by any hidden functionality" ถ้าไม่พูด ถือเป็น rejection reason ข้อ 2 ตรง ๆ |
| 6 | **2FA + desktop app** | ต้องเปิด 2FA และ publish จาก desktop app |
| 7 | **Community profile** | ต้องมีก่อน; ถ้าไฟล์/plugin ถูกสร้างในบัญชี org ของ Health at Home → **by default publish ขึ้น personal profile ไม่ได้** ต้องย้ายไป personal/non-org team หรือให้ org admin เปิด `Admin > Settings > Other > Community file publishing` |
| 8 | **Privacy policy** | **ยังไม่มี** — ตามตัวหนังสือ บังคับเมื่อ "processes user data" / "processes or stores customer data outside the customer's file" ANNOCON เก็บทุกอย่างใน `pluginData` และ `networkAccess: none` จึงไม่ส่งข้อมูลออกนอกไฟล์เลย → **ตามเกณฑ์ที่เขียนไว้ ไม่เข้าข่ายบังคับ** แต่ Figma ไม่ได้เขียน exemption ตรง ๆ (จุดนี้ **ไม่ชัดใน docs**) ถ้าอยากปลอดภัย ทำหน้าเดียวสั้น ๆ ว่า "ไม่เก็บ ไม่ส่ง ไม่มี network" ก็จบ ต้นทุนต่ำ |
| 9 | **Security disclosure form** | optional และยัง open beta แต่ ANNOCON จะตอบผ่านทุกข้อแบบสวย (ไม่มี backend, ไม่มี network request, ไม่ auth, ไม่เก็บ data นอก Figma) — กรอกไปเถอะ เป็น trust signal ที่ได้มาฟรี แค่รอ approve ได้ถึง 2 สัปดาห์ |
| 10 | **Category + tags** | ต้องเลือก category (น่าจะ "Design tools" หรือ "Software development"); tags ได้ถึง 5 อัน ยาวไม่เกิน 25 ตัวอักษร (หน้า classic ไม่ระบุช่อง tags ตรง ๆ แต่หน้า Grow your audience บอกว่ามี) |

### ประเมินความเสี่ยง "recreating core Figma functionality"

ถ้อยคำจริง ([review guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines),
last updated 2026-09-03):

> "We may not approve plugins or widgets that recreate Figma functionality,
> including the core capabilities of Figma products such as the Figma agent and
> the Figma MCP server."

และข้อถัดมา:

> "We may not approve plugins or widgets that function as a workaround to Figma's
> paid offerings."

**อ่านตามตัวอักษรแล้วความเสี่ยงอยู่ระดับ "ปานกลาง-ต่ำ แต่ไม่เป็นศูนย์"** เหตุผล:

**ปัจจัยที่ลดความเสี่ยง**

1. คำว่า **"may not approve"** ไม่ใช่ "will not" หรือ "must not" — เป็นดุลพินิจ
   ไม่ใช่ข้อห้ามเด็ดขาด และหมวดนี้เปิดหัวไว้ว่า "The Figma plugin and widget
   review team will use its best judgment"
2. ตัวอย่างที่ Figma **เลือกยกมาเอง** คือ **Figma agent** และ **Figma MCP server**
   — ทั้งคู่เป็น AI/programmatic-access surface ทิศทางของ guideline รอบ 2026 คือ
   กันเรื่อง AI เป็นหลัก ไม่ใช่ editing utility ทั่วไป ไม่มีการเอ่ยถึง annotations
   หรือ connectors เลย
3. **Connect: Figma Design ไม่มี native connector** — help center มีแต่
   [Create diagrams and flows with connectors in FigJam](https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam)
   (updated 2026-07-29) เป็น FigJam-only ไม่พบบทความ connector สำหรับ Figma Design
   → เราไม่ได้ recreate ฟีเจอร์ที่มีอยู่ใน editor เดียวกัน แต่กำลัง**เติม**สิ่งที่
   editor นี้ไม่มี ซึ่งตรงกับสิ่งที่ guideline บอกว่าชอบ ("extend and complement
   Figma's native capabilities" — เขียนไว้ในบริบท AI แต่สะท้อนเจตนารวม)
4. **Annotate: output ต่างชนิดกันจริง** —
   [Add measurements and annotate designs](https://help.figma.com/hc/en-us/articles/20774752502935-Add-measurements-and-annotate-designs)
   (updated 2026-08-27) บอกว่า native annotation คือ metadata ผูกกับ layer
   ที่ developer เห็น "in Dev Mode" ส่วน ANNOCON เรนเดอร์ **node จริงบน canvas**
   ที่รอด export และ presentation mode — เป็น use case ที่ native ทำไม่ได้
   (นี่คือเหตุผลที่ ADR 0001 มีอยู่ ควรยกไปเขียนใน description ตรง ๆ)

**ปัจจัยที่เพิ่มความเสี่ยง**

1. native annotations **ขยับเข้ามาใกล้กว่าเดิม** — บทความปี 2026 ระบุว่า
   "You can add annotations from **Design or Dev Mode**" ไม่ใช่ Dev Mode-only แล้ว
   ชื่อฟีเจอร์และ mental model ทับกันตรง ๆ reviewer ที่อ่านแค่ tagline
   อาจตีความว่าซ้ำ
2. native annotations เป็นของ **"all paid plans" + ต้องมี Full seat (แก้) และ
   Full/Dev seat (ดู)** → ถ้า ANNOCON ถูกอ่านว่าเป็นวิธีให้คน Starter plan หรือ
   คนที่ไม่มี Dev seat ได้ annotation ฟรี ก็เข้าข่ายข้อ **"function as a workaround
   to Figma's paid offerings"** ตรง ๆ — **นี่คือความเสี่ยงที่แท้จริงกว่าข้อ
   "recreate functionality" เสียอีก** และเป็นข้อที่ CLAUDE.md ยังไม่ได้บันทึกไว้
3. ชื่อ **"ANNOCON" = ANNOtate + CONnect** สื่อชื่อฟีเจอร์ native ทั้งสองตัวพร้อมกัน
4. ยังมีข้อ "not for publishing plugins/widget that are meant to be used only by an
   internal team" — CLAUDE.md ระบุเองว่า "other people on the team use this"
   ถ้า positioning ยังเป็น internal tool ก็ชนข้อนี้ ไม่ใช่ข้อ core-functionality

**ข้อเสนอ**

- **ถ้าเป้าคือให้ทีม Health at Home ใช้เท่านั้น** → publish **private to
  organization** คือคำตอบที่ guidelines ชี้ให้ทำเองตรง ๆ: ไม่ต้อง review เลย
  ("Figma doesn't review any plugins you choose to share privately within an
  organization"), ไม่ต้องมี assets ครบชุด, ไม่ต้องมี privacy policy, เปลี่ยนใจไป
  public ทีหลังได้ (แต่ตอนนั้นต้องเข้า review และต้องเป็น original publisher)
  **เงื่อนไข: ต้องอยู่บน Organization หรือ Enterprise plan** — ถ้า Health at Home
  อยู่บน Professional plan ตัวเลือกนี้**ไม่มี** เหลือแค่ให้แต่ละคน import manifest
  เอง (วิธีที่ CLAUDE.md ใช้อยู่) หรือไป public
- **ถ้าจะ public** ให้ลดความเสี่ยงด้วยการเขียน positioning ให้ชัดว่า
  **ไม่ใช่** การแทน native annotations แต่คือ "annotations ที่เป็น node จริง
  รอด export/presentation/PDF" และ "connectors ใน Figma Design (ไม่ใช่ FigJam)"
  พร้อมพูดข้อจำกัดเรื่อง re-route ตรง ๆ — ทั้งหมดนี้ตอบทั้งข้อ accurate
  description และช่วยกันข้อ recreate/workaround ไปพร้อมกัน
- ถ้าถูก reject จริง ไม่ใช่ทางตัน: "You may submit your plugin or widget again for
  review after addressing any feedback"

### สรุปสิ่งที่ **ไม่ได้** ระบุใน docs (อย่าเดา)

- ระยะเวลา review เป็นตัวเลข — Figma เลิกให้ SLA แล้ว (ตัวเลข 2 สัปดาห์คือของ
  security disclosure form)
- ขนาดไฟล์สูงสุดของ plugin bundle
- format รูปที่รับได้ (PNG/JPG/WEBP/…) และขนาดไฟล์สูงสุดของ asset
- ว่า plugin ที่ networkAccess เป็น `none` ได้รับการยกเว้นข้อบังคับ privacy policy
  หรือไม่
- ตัวเลข carousel media ที่ถูกต้อง (publishing doc = 9, Grow your audience = 10)
- รายการ category/subcategory ทั้งหมดของ plugin (docs ยกมาแค่ตัวอย่าง)
