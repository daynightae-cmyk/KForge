# تدقيق الاعتماديات والأدوات المحلي

> **النطاق:** هذا الملف يحافظ على السجل التاريخي لتدقيق 26 أغسطس 2026، ويضيف فوقه حالة التحقق الأحدث المثبتة من GitHub Actions. لا يثبت أمن مزود خارجي أو توقيع حزمة أو خلو بيئة جهاز نظيف من المشكلات.

## الحالة المرجعية الحالية — 8 سبتمبر 2026

أصبحت الحالة المرجعية الأحدث هي GitHub Actions `KForge Verification Gate` Run #271 على SHA `a7464f3d3f1758b1a9725304719e0ebaacb79f3b`.

في هذا التشغيل:

- `npm ci` ثبّت 691 حزمة، ثم دقق npm إجمالي 692 حزمة.
- `npm audit --audit-level=moderate` مر بنجاح وأبلغ عن **0 vulnerabilities**.
- سياسة lifecycle scripts أصبحت fail-closed: `.npmrc` يحتوي `strict-allow-scripts=true`، و`package.json` يسمح فقط بالإصدارات الدقيقة `@swc/core@1.16.1` و`esbuild@0.25.4` و`fsevents@2.3.2`.
- تم إثبات نجاح `npm ci` تحت هذه السياسة على Linux وWindows في Run #271. أي package/version جديد يملك install script وغير موجود في allowlist يفشل التثبيت بدل أن يتحول إلى warning صامت.
- سلسلة React Router مستقرة على `react-router-dom@7.18.3` في خط الاعتماديات المدقق؛ نتيجتا React Router المتوسطتان التاريخيتان من لقطة 26 أغسطس لم تعودا قائمتين.
- typecheck نجح.
- lint نجح عبر 217 ملف مصدر.
- 34 ملف Vitest نجحوا: 166 اختبارًا ناجحًا و1 benchmark اختياريًا متخطى.
- production client/server build نجح.
- حزمة التطبيق الرئيسية 487.85 kB بعد minification، وReact Query في chunk مستقل 26.69 kB؛ تحذير Vite السابق الخاص بتجاوز 500 kB للحزمة الرئيسية غير موجود.
- 61/61 اختبار Playwright نجح، بما في ذلك Preview Studio وOnline Explorer وCanonical Inspector والـWorkspace والحدود الأمنية/المرئية.
- بوابة Windows NSIS وبوابة installed-runtime/installer lifecycle نجحتا على نفس SHA، وتم رفع installer/evidence artifacts.

## تنظيف dependency graph غير القابل للوصول

بعد إزالة Knoux Edita/media graph القديم وغير القابل للوصول من entrypoints الحالية، تم تشغيل `npm uninstall --save-dev @react-three/drei @react-three/fiber @types/three framer-motion three --package-lock-only` داخل GitHub Actions بدل تحرير lockfile يدويًا. لم يُسمح بالـcommit إلا بعد نجاح `npm ci` و`npm audit` وtypecheck وlint وVitest وproduction build. نتج عن ذلك حذف 5 declarations مباشرة و741 سطرًا من `package-lock.json`، وانخفضت الشجرة المقفلة إلى 691 package مثبتة / 692 package مدققة مع **0 vulnerabilities**. يؤكد Run #271 أن full aggregate gate وWindows NSIS/installed-runtime lifecycle ظلا خضراء بعد التنظيف.

## تشريح إغلاق install-script gap

قبل hardening كان npm يبلّغ عن pending install-script review لـ`@swc/core` و`esbuild`. بدل إسكات التحذير أو استخدام `dangerously-allow-all-scripts`، تم تحويل السياسة إلى منع افتراضي:

1. أضيفت `strict-allow-scripts=true` إلى `.npmrc`.
2. أضيفت موافقات exact-version إلى `allowScripts` في `package.json`.
3. Run #260 أثبت أن السياسة تعمل فعلًا عندما أوقف Windows `npm ci` بسبب `fsevents@2.3.2` غير المغطى، بدل السماح له ضمنيًا.
4. أضيف `fsevents@2.3.2` كإصدار محدد بعد ظهوره كاعتماد platform-specific موجود في الشجرة المقفلة؛ لم يُستخدم wildcard.
5. Run #261 اجتاز `npm ci` على Linux وWindows ثم typecheck/build/tests/E2E/NSIS/runtime lifecycle كاملة.

النتيجة: فجوة “pending install-script review” السابقة **مغلقة للـlockfile الحالي**. تحديث أي من هذه الإصدارات أو دخول package جديدة لها lifecycle script يعيد الحاجز تلقائيًا حتى تتم مراجعتها وتثبيتها صراحة.

## اللقطة التاريخية — 26 أغسطس 2026

أُجري في ذلك التاريخ تدقيقان منفصلان بعد تحديثات الاعتماديات: `npm audit --omit=dev --json` لسطح وقت التشغيل، و`npm audit --json` لشجرة التطوير الكاملة. كانت النتيجة التاريخية كما يلي، ولا ينبغي استخدامها بدل Run #271 للحكم على baseline الحالي.

| النطاق | الاعتماديات الكلية | حرج | عالٍ | متوسط | منخفض | النتيجة وقتها |
|---|---:|---:|---:|---:|---:|---|
| الإنتاج (`--omit=dev`) | 809 | 0 | 0 | 0 | 0 | **PASS** |
| الشجرة الكاملة | 809 | 0 | 0 | 2 | 0 | **كان يحتاج ترقية React Router كبرى** |

كانت النتيجتان المتوسطتان في اللقطة التاريخية مرتبطتين بـ`react-router` و`react-router-dom` ضمن السلسلة 6.x. لم يُستخدم وقتها `npm audit fix --force`. لاحقًا نُفذت الترقية المدققة إلى React Router 7.x، ويثبت Run #271 أن التدقيق الحالي أصبح صفريًا.

| المكوّن أو المسار | الحالة في مسار المعالجة | المعالجة المنفذة | الحالة المرجعية الحالية |
|---|---|---|---|
| Vitest | ثغرة حرجة مباشرة في إصدار أقدم | تحديث متوافق إلى 3.2.7 عبر الإصلاح القياسي | لا ثغرة حرجة متبقية في Run #271 |
| Vite وRollup وPostCSS | ثغرات عالية مباشرة أو متعدية ضمن أدوات البناء في لقطة أقدم | تحديثات متوافقة داخل السلاسل المدققة | لا ثغرة عالية متبقية في Run #271 |
| React Router | بقيت نتيجتان متوسطتان على 6.x في 26 أغسطس | ترقية مدققة لاحقًا إلى 7.18.3 | 0 vulnerabilities في Run #271 |
| Picomatch في مسارات Tailwind 3 | ثغرة عالية متعدية في 2.3.1 | تجاوزات مقيدة لمسارات Tailwind إلى 2.3.2 مع Picomatch 4.x للفروع الأحدث | شجرة القفل الحالية تجتاز audit |
| `@vitejs/plugin-react-swc` | peer غير صالح في سلسلة أقدم | ترقية إلى 4.3.3 المتوافقة مع Vite الحديث | شجرة Vite الحالية تبني بنجاح |
| `browserslist`, `postcss-selector-parser`, `qs` | نتائج transitive أعادت aggregate gate إلى الأحمر في سبتمبر | تحديث lockfile إلى الإصدارات المصححة بدون تخفيف audit | Run #271: 0 vulnerabilities |
| Install scripts | مراجعة غير enforced كانت تظهر كتحذير | `strict-allow-scripts=true` + exact-version allowlist؛ لا wildcard أو global bypass | Run #271: locked install PASS على Linux وWindows |
| Main client chunk | كان يتجاوز حد Vite الافتراضي 500 kB بعد minification | فصل `@tanstack/react-query` إلى vendor chunk مستقل | Run #271: main entry 487.85 kB؛ query chunk 26.69 kB |

## سلامة الإجراء

لم تُخفَّض صرامة بوابة الأمان ولم يُضف bypass. `scripts/verify-gate.mjs` ما زال يشغّل `npm audit --audit-level=moderate` كخطوة إلزامية، ولا يعتبر البوابة PASS إلا إذا نجحت audit مع بقية الخطوات المطلوبة.

كما لا توجد موافقة عامة على install scripts. السياسة الحالية تربط السماح باسم الحزمة **والإصدار المحدد**. `dangerously-allow-all-scripts` غير مستخدم، ويغطي regression test هذه الخاصية داخل المستودع.

## تحذيرات الأدوات وCI

تستخدم بوابة التحقق Node 24 وإجراءات GitHub الرسمية مثبتة على immutable commit SHAs. يتحقق `scripts/verify-workflow-pins.mjs` من هذه الخاصية قبل تثبيت الاعتماديات.

كشف مسار سابق مع تتبع الإهمال أن `DEP0190` كان مصدره غلافا التنفيذ المحلي وفحص وقت التشغيل في `server/routes/workspace.ts` عند تمرير أوامر npm عبر `shell: true` على Windows. استُبدل ذلك بتنفيذ Node/npm CLI مقيد مع `shell: false`، وتبقى هذه المعالجة ضمن مسار التحقق الحالي.

تبقى بعض رسائل deprecation من اعتماديات متعدية مثل `inflight`, `glob`, و`boolean`. لا تُصنَّف في Run #271 كثغرات audit، لكنها تبقى هدف صيانة dependency graph مستقبلية عند توفر ترقية آمنة من السلسلة المالكة لها.

## الأدلة المصدرية الحالية

| الأمر / البوابة | الدليل المرجعي في Run #271 |
|---|---|
| `npm ci` | 691 packages added; 692 packages audited؛ PASS تحت strict allowScripts |
| `npm audit --audit-level=moderate` | 0 vulnerabilities؛ PASS |
| install-script policy | exact pins: `@swc/core@1.16.1`, `esbuild@0.25.4`, `fsevents@2.3.2`; Linux + Windows PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS؛ 217 source files |
| `npm test` | 34 files؛ 166 passed؛ 1 skipped benchmark |
| `npm run build` | PASS؛ main client entry 487.85 kB؛ query vendor chunk 26.69 kB |
| `npm run test:e2e` | 61/61 PASS |
| Preview telemetry regressions | PASS؛ bounded packaged-Electron browser traffic + redacted attributed browser-console evidence ضمن active KForge-owned loopback Preview |
| Windows package gate | NSIS build + installed runtime/lifecycle + artifact upload PASS |

المرجع الرسمي لأي commit أحدث هو تشغيل `KForge Verification Gate` على نفس SHA، وليس هذه اللقطة النصية وحدها.
