# تدقيق الاعتماديات والأدوات المحلي

> **النطاق:** هذا الملف يحافظ على السجل التاريخي لتدقيق 26 أغسطس 2026، ويضيف فوقه حالة التحقق الأحدث المثبتة من GitHub Actions. لا يثبت أمن مزود خارجي أو توقيع حزمة أو خلو بيئة جهاز نظيف من المشكلات.

## الحالة المرجعية الحالية — 8 سبتمبر 2026

أصبحت الحالة المرجعية الأحدث هي GitHub Actions `KForge Verification Gate` Run #254 على SHA `82461f1f7782799bae09889c4523f367f9341e93`.

في هذا التشغيل:

- `npm ci` ثبّت 752 حزمة، ثم دقق npm إجمالي 753 حزمة.
- `npm audit --audit-level=moderate` مر بنجاح وأبلغ عن **0 vulnerabilities**.
- سلسلة React Router انتقلت إلى `react-router-dom@7.18.3` داخل ملف المنتج، لذلك نتيجتا React Router المتوسطتان المذكورتان في لقطة 26 أغسطس لم تعودا قائمتين في المرجع الحالي.
- typecheck نجح.
- lint نجح عبر 240 ملف مصدر.
- 33 ملف Vitest نجحوا: 161 اختبارًا ناجحًا و1 benchmark اختياريًا متخطى.
- production build نجح.
- 61/61 اختبار Playwright نجح.
- بوابة Windows NSIS وبوابة installed-runtime/installer lifecycle نجحتا على نفس SHA.

يبقى تحذير مستقل عن الثغرات: npm يعرض pending install-script review لـ`@swc/core@1.16.1` و`esbuild@0.25.4`. لا تُعتبر هذه الموافقة ممنوحة ضمن KForge، ونجاح البناء لا يُحوّلها إلى موافقة ضمنية.

## اللقطة التاريخية — 26 أغسطس 2026

أُجري في ذلك التاريخ تدقيقان منفصلان بعد تحديثات الاعتماديات: `npm audit --omit=dev --json` لسطح وقت التشغيل، و`npm audit --json` لشجرة التطوير الكاملة. كانت النتيجة التاريخية كما يلي، ولا ينبغي استخدامها بدل Run #254 للحكم على HEAD الأحدث.

| النطاق | الاعتماديات الكلية | حرج | عالٍ | متوسط | منخفض | النتيجة وقتها |
|---|---:|---:|---:|---:|---:|---|
| الإنتاج (`--omit=dev`) | 809 | 0 | 0 | 0 | 0 | **PASS** |
| الشجرة الكاملة | 809 | 0 | 0 | 2 | 0 | **كان يحتاج ترقية React Router كبرى** |

كانت النتيجتان المتوسطتان في اللقطة التاريخية مرتبطتين بـ`react-router` و`react-router-dom` ضمن السلسلة 6.x. لم يُستخدم وقتها `npm audit fix --force`. لاحقًا نُفذت الترقية المدققة إلى React Router 7.x، ويثبت Run #254 أن التدقيق الحالي أصبح صفريًا.

| المكوّن أو المسار | الحالة في مسار المعالجة | المعالجة المنفذة | الحالة المرجعية الحالية |
|---|---|---|---|
| Vitest | ثغرة حرجة مباشرة في إصدار أقدم | تحديث متوافق إلى 3.2.7 عبر الإصلاح القياسي | لا ثغرة حرجة متبقية في Run #254 |
| Vite وRollup وPostCSS | ثغرات عالية مباشرة أو متعدية ضمن أدوات البناء في لقطة أقدم | تحديثات متوافقة داخل السلاسل المدققة | لا ثغرة عالية متبقية في Run #254 |
| React Router | بقيت نتيجتان متوسطتان على 6.x في 26 أغسطس | ترقية مدققة لاحقًا إلى 7.18.3 | 0 vulnerabilities في Run #254 |
| Picomatch في مسارات Tailwind 3 | ثغرة عالية متعدية في 2.3.1 | تجاوزات مقيدة لمسارات Tailwind إلى 2.3.2 مع Picomatch 4.x للفروع الأحدث | شجرة القفل الحالية تجتاز audit |
| `@vitejs/plugin-react-swc` | peer غير صالح في سلسلة أقدم | ترقية إلى 4.3.3 المتوافقة مع Vite الحديث | شجرة Vite الحالية تبني بنجاح |
| `browserslist`, `postcss-selector-parser`, `qs` | نتائج transitive أعادت aggregate gate إلى الأحمر في سبتمبر | تحديث lockfile إلى الإصدارات المصححة بدون تخفيف audit | Run #254: 0 vulnerabilities |

## سلامة الإجراء

لم تُخفَّض صرامة بوابة الأمان ولم يُضف bypass. `scripts/verify-gate.mjs` ما زال يشغّل `npm audit --audit-level=moderate` كخطوة إلزامية، ولا يعتبر البوابة PASS إلا إذا نجحت خطوة audit مع بقية الخطوات المطلوبة.

بقيت نصوص تثبيت `@swc/core` و`esbuild` غير معتمدة تلقائيًا. في Run #254 أبلغ npm عن ذلك صراحة بعد `npm ci`، ثم نجح typecheck والبناء والاختبارات. هذا يثبت نجاح مسار KForge الحالي فقط؛ لا يمنح تلك install scripts صلاحية لم تُراجع.

## تحذيرات الأدوات وCI

تستخدم بوابة التحقق Node 24 وإجراءات GitHub الرسمية مثبتة على immutable commit SHAs. يتحقق `scripts/verify-workflow-pins.mjs` من هذه الخاصية قبل تثبيت الاعتماديات.

كشف مسار سابق مع تتبع الإهمال أن `DEP0190` كان مصدره غلافا التنفيذ المحلي وفحص وقت التشغيل في `server/routes/workspace.ts` عند تمرير أوامر npm عبر `shell: true` على Windows. استُبدل ذلك بتنفيذ Node/npm CLI مقيد مع `shell: false`، وتبقى هذه المعالجة ضمن مسار التحقق الحالي.

يبقى تحذير build غير أمني: حزمة التطبيق الرئيسية تتجاوز حد Vite الافتراضي البالغ 500 kB بعد minification. هذا هدف تحسين أداء وتقسيم حزم، وليس ثغرة audit أو فشل correctness.

## الأدلة المصدرية الحالية

| الأمر / البوابة | الدليل المرجعي في Run #254 |
|---|---|
| `npm ci` | 752 packages added; 753 packages audited |
| `npm audit --audit-level=moderate` | 0 vulnerabilities؛ PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS؛ 240 source files |
| `npm test` | 33 files؛ 161 passed؛ 1 skipped benchmark |
| `npm run build` | PASS؛ مع تحذير chunk-size غير حاجز |
| `npm run test:e2e` | 61/61 PASS |
| Windows package gate | NSIS build + installed runtime/lifecycle PASS |

المرجع الرسمي لأي commit أحدث هو تشغيل `KForge Verification Gate` على نفس SHA، وليس هذه اللقطة النصية وحدها.
