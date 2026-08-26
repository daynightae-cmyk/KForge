# مصفوفة قدرات منتج KNOuX Forge

> **المرجع التشغيلي لهذا الإغلاق:** الشجرة التي بدأت من `87cedb63fb3bfba253c354553d9e29df258332cc`، مع أدلة القبول والبناء عند `4119e41541769875476b5ed8e727ed73c6a89412`. لا تمثل هذه الوثيقة شهادة عامة أو افتراضاً عن خدمات بعيدة؛ إنها سجل ما شُغّل محلياً، وما يملكه المنتج فعلياً، وما يبقى حاجز تهيئة خارجي صريحاً.

## قاعدة القرار وحالة الإغلاق

لا تُعد الشاشة وحدها دليلاً. لا يرقى الصف إلى `COMPLETE_VERIFIED` إلا إذا كان له **مالك سلوك محلي**، ومسار نجاح أو فشل صادق، ودليل اختبار أو قياس موجّه. وتظل الحالة `BLOCKED_BY_EXTERNAL_CONFIGURATION` عندما يحتاج السلوك نفسه إلى اعتماد أو سياسة أو موفر أو اتصال لم يهيأ داخل المنتج، لا لمجرد أن الواجهة تعرض بطاقته.

| الحالة النهائية | عدد الصفوف | معنى الحكم |
|---|---:|---|
| `COMPLETE_VERIFIED` | 47 | اكتمل السلوك المحلي المنشور واختبر في مصدره أو في بناء الإنتاج أو كليهما. قد يعرض مزود خارجي داخل الصف حالة غير متاح صادقة، ولا يغير ذلك اكتمال المالك المحلي. |
| `BLOCKED_BY_EXTERNAL_CONFIGURATION` | 5 | تكاملات GitHub البعيدة فقط: بيانات الاعتماد/السياسة/محول المنتج غير مهيأة، ولا توجد بيانات بديلة أو نتائج ناجحة مصطنعة. |
| `PARTIAL` أو `UI_ONLY` أو `BACKEND_ONLY` أو `NOT_IMPLEMENTED` | 0 | لا يبقى صف محلي منشور بهذه الحالات في هذا الإصدار. |

تشمل أدلة الإغلاق المشتركة اختبار الوحدة `npm run test` (**28 ملفاً، 122 اختباراً ناجحاً وواحد متجاوز**) وقبول الإنتاج المتسلسل `npm run test:e2e` (**30/30 ناجحاً**). كما اجتاز `npm run typecheck` و`npm run lint` و`npm run build`. بوابة GitHub Actions للتزام الدليل المذكور أعلاه نجحت في مهمتي **aggregate verification gate** و**Windows NSIS package gate**: [التشغيل 32962412420](https://github.com/daynightae-cmyk/KForge/actions/runs/32962412420). هذا دليل تطوير منفصل عن تكامل GitHub داخل المنتج، الذي يبقى غير مهيأ كما توضح الصفوف 39–43.

## فهرس الأدلة الحاكمة

| الدليل | ما يثبته |
|---|---|
| `tests/e2e/reachable-navigation-audit.spec.ts` | تشغيل جميع وجهات الشريط الجانبي الـ66 بلوحة المفاتيح في بناء الإنتاج، بعنوان صحيح وسطح واحد فقط، ومن دون خطأ صفحة/Console أو اتصال HTTP خارجي. |
| `tests/e2e/accessibility-keyboard-evidence.spec.ts` و[تدقيق الإتاحة](./DYNAMIC_UI_AND_ACCESSIBILITY_AUDIT.md) | Axe بلا مخالفات مكتشفة في Workspace وMarketplace وSettings؛ حبس التركيز واستعادته، Escape، Enter/Space، والتركيز المرئي. هذا ليس اعتماد WCAG شاملًا. |
| `tests/e2e/settings-platform-evidence.spec.ts` و`online-control-center-evidence.spec.ts` | مثابرة الإعدادات وتأثيرها وقياسات النظام وسياسة Offline وحظر الاتصال التلقائي. |
| `tests/e2e/marketplace-local-lifecycle.spec.ts` و`ai-provider-evidence.spec.ts` | دورة امتداد محلي bundled، وصحة الإضافة وتحديثها وإزالتها، وحالات موفري الذكاء وإخفاء الأسرار. |
| `tests/e2e/project-intelligence-evidence.spec.ts` و`product-surface-evidence.spec.ts` | الرسم، الأثر، الاعتماديات، الفهم، المعمارية، الأسئلة الحتمية، وأدلة الجودة المحلية. |
| `tests/e2e/quality-scan-solution-evidence.spec.ts` و`quality-snapshot-evidence.spec.ts` | مشكلات حقيقية، أمن بلا تنزيل ضمني، حل آمن مراجع، توثيق، دين تقني، Snapshot واسترجاع bytes. |
| `tests/e2e/developer-git-surface-evidence.spec.ts` و`git-local-operations.spec.ts` | أوامر المطور الحقيقية وسجلاتها، Git المحلي الموثوق، branch/stage/unstage/commit، ورفض push البعيد غير المؤكد. |
| `tests/e2e/agent-mission-evidence.spec.ts` و`self-audit-run-evidence.spec.ts` | رحلة المهمة وحالاتها المثبتة، والفحص الذاتي الرصدي مع حد restart حقيقي. |
| `tests/e2e/release-evidence.spec.ts` و[تدقيق الواجهات الصفرية](./ZERO_DEAD_UI_MOCK_AUDIT.md) | فصل أدلة الإصدار وSHA محلي عن CI، وعدم وجود سطح KForge منشور ذي نجاح أو مصدر بيانات مصطنع. |
| [معيار المشروع الكبير](./LARGE_PROJECT_BENCHMARK.md) | تشغيل fixture من 5 حزم و5,100 ملف مصدر مع حدود تغطية وذاكرة ورسوم بيانية معلنة. |

## Workspace، المنصة، والمصادر المحلية

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 1 | قشرة Workspace والتنقل | `KForgeWorkspace` يملك الشريط الثابت والرأس وفتات المسار؛ كل تنقل يستبدل السطح ولا يراكمه. | Workspace ينشر عنوانه المنتج `Projects`؛ لا يقدّم سطحاً موازياً. | `reachable-navigation-audit`، `workspace-acceptance` | `COMPLETE_VERIFIED` |
| 2 | مشاريع Workspace | مسارات workspace المحلية تكتشف وتفتح وتبحث وتفرز وتختار المشاريع وتنفذ الإجراءات الجماعية. | المشروع غير الموثوق لا يملك تنفيذ أدوات؛ فتحه لا يعني منح الثقة. | `workspace-table-evidence` | `COMPLETE_VERIFIED` |
| 3 | Recent / Favorites / Pinned / Archive | ملكية collections تحت `.kforge`، مع تغيير ظاهر واستمرار عبر reload. | لا مزامنة بعيدة ولا إدعاء تاريخ حساب. | `workspace-acceptance` | `COMPLETE_VERIFIED` |
| 4 | Settings Center | API الإعدادات وواجهة Settings يحفظان القيم القابلة للتحرير ويطبقان الأثر DOM/المحلي. | المجالات غير القابلة للتحرير تظل `MANAGED_ELSEWHERE` أو `UNAVAILABLE`. | `settings-platform-evidence`، `accessibility-keyboard-evidence` | `COMPLETE_VERIFIED` |
| 5 | أوضاع التشغيل | مالك سياسة المنصة ينتقل صراحة بين Offline وLocal-first وOnline Optional وOnline. | Offline يمنع الاتصال البعيد ولا يعرض نجاح مزود. | `settings-platform-evidence` | `COMPLETE_VERIFIED` |
| 6 | Online Control Center | يعرض سياسة الخدمة، cache/contact evidence، وحالة كل مصدر من العقد المحلي. | مصدر لم يهيأ هو `OFFLINE`/`NOT_CONFIGURED` بلا طلب تلقائي. | `online-control-center-evidence` | `COMPLETE_VERIFIED` |
| 7 | Online Hub | مناطق ومفتش وبحث وفلاتر مربوطة بالحالة المحلية نفسها. | لا يصنع سجلات أو مزودين عند انعدام المحول البعيد. | `online-control-center-evidence`، `product-surface-evidence` | `COMPLETE_VERIFIED` |
| 8 | Marketplace discovery | registry محلي bundled ودورة inspect/install/health/run/update/uninstall فعلية. | discovery أو download البعيد لا يعمل دون registry مهيأ. | `marketplace-local-lifecycle` | `COMPLETE_VERIFIED` |
| 9 | Extensions | قسم Extensions يقرأ lifecycle المحلي للـMarketplace ويعرض العناصر أو الحالة الفارغة الحقيقية. | لا تقييمات أو تنزيلات أو عناصر سوق مصطنعة. | `marketplace-local-lifecycle`، `reachable-navigation-audit` | `COMPLETE_VERIFIED` |
| 10 | Model Hub | فحص Ollama/runtime وتوافق الجهاز والنماذج المحلية عبر مالك محلي. | runtime الغائب يظهر `UNAVAILABLE`/غير مهيأ، لا نموذج وهمي. | `product-surface-evidence`، `system-diagnostics-evidence` | `COMPLETE_VERIFIED` |
| 11 | AI Providers | فحص تهيئة الموفر محلياً مع إخفاء قيمة السر، وعرض `CONFIGURED` أو `NOT_CONFIGURED`. | استدعاء موفر سحابي يحتاج اعتماداً وسياسة؛ لا تسريب مفتاح. | `ai-provider-evidence` | `COMPLETE_VERIFIED` |

## الوكلاء وفهم المشروع

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 12 | Agents | `MissionOrchestrator` يملك أدوات وموافقات ومثابرة المهمة ضمن حدود المشروع. | أداة غير مصرح بها أو مشروع غير موثوق لا ينفذ بصمت. | `agent-mission-evidence`، `server/services/agentTools.spec.ts` | `COMPLETE_VERIFIED` |
| 13 | Mission Engine UX | إنشاء المراحل والأدلة والمحاولات وحالات الإيقاف/الإعادة/الاستئناف في الواجهة. | حالة الاسترداد ظاهرة ومثبّتة، لا نجاح نهائي مزيّف. | `agent-mission-evidence` | `COMPLETE_VERIFIED` |
| 14 | Task Center | مهام دائمة وعمليات cancel/retry/resume/rollback مرتبطة بمالك المهمة. | لا يمكن التحكم بمهمة لا تقبل الانتقال؛ تسجل النتيجة. | `agent-mission-evidence` | `COMPLETE_VERIFIED` |
| 15 | Project Graph | graph محدود المصدر مع cache وcoverage state وملاحة node محلية. | تخطي الحد يعلن `LIMIT_REACHED` ولا يدعي تغطية كلية. | `project-intelligence-evidence`، `server/routes/performance.spec.ts` | `COMPLETE_VERIFIED` |
| 16 | Dependencies | manifest discovery محلي يربط كل dependency بمصدره وملفه. | عدم وجود manifest حالة بلا نتائج، لا قائمة مولدة. | `project-intelligence-evidence` | `COMPLETE_VERIFIED` |
| 17 | Impact Analysis | استعلام رموز ومسارات الرسم يعيد دليل مصدر محدوداً. | لا يوجد أثر حقيقي يعني نتيجة فارغة موضحة، لا تخمين. | `project-intelligence-evidence` | `COMPLETE_VERIFIED` |
| 18 | Code Understanding | project profile وsource roots ورسم APIs ومعاينة ملفات ذات أدلة. | الحدود والحجم والمصادر غير المقروءة تظهر ضمن التغطية. | `project-intelligence-evidence` | `COMPLETE_VERIFIED` |
| 19 | Ask KForge | إجابة قواعد حتمية محلية تربط الاستنتاج بدليل المشروع. | Local AI غير المهيأ يبقى غير متاح؛ لا جواب منسوب لنموذج. | `project-intelligence-evidence`، `product-surface-evidence` | `COMPLETE_VERIFIED` |
| 20 | Architecture Center | محلل الوحدات والحدود والدورات والقيود يملك العرض والمصدر. | قيد غير محقق أو غياب بياناته يظل دليل محدوداً صريحاً. | `project-intelligence-evidence` | `COMPLETE_VERIFIED` |

## الجودة، الأمان، والاستعادة

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 21 | KForge Sonar | scanner محلي يشغّل scan ويصنف النتائج مع source/rule/confidence. | لا يفترض نجاح فحص أداة غير متاحة. | `quality-scan-solution-evidence` | `COMPLETE_VERIFIED` |
| 22 | Problems | `ProblemsCenter` يملك الفلاتر والبحث والتفاصيل والانتقال من الدليل. | النتيجة خالية أو محدودة مصدر موثق، لا placeholder نتيجة. | `quality-scan-solution-evidence` | `COMPLETE_VERIFIED` |
| 23 | Solutions | preview/apply لحل حتمي آمن فقط، بعد مراجعة وSnapshot ثم verify/rollback. | secret finding لا يرقع تلقائياً؛ حل غائب يعلن عدم وجود حل آلي. | `quality-scan-solution-evidence` | `COMPLETE_VERIFIED` |
| 24 | Security Center | أدوات الأمن المحلية وحالة availability وredaction تملكها service الأمن. | لا تنزيل أو تنفيذ ضمني لأداة مفقودة، ومفتاح مكتشف لا يعرض محتواه. | `quality-scan-solution-evidence`، `quality-snapshot-evidence` | `COMPLETE_VERIFIED` |
| 25 | Performance | profile/benchmark محلي بحدود ملفات ورسوم وذاكرة قابلة للقياس. | القياس ليس وعد أداء لجهاز آخر أو لحزمة نظيفة. | `performance.spec.ts`، `LARGE_PROJECT_BENCHMARK.md` | `COMPLETE_VERIFIED` |
| 26 | Technical Debt | اشتقاق محلي من TODO والجودة/التعقيد/المعمارية مع مصدر finding. | لا score عام مصطنع عند غياب source evidence. | `quality-scan-solution-evidence` | `COMPLETE_VERIFIED` |
| 27 | Documentation | audit للفجوات وأوامر stale command مع preview/apply/verify. | لا تعديل توثيق غير مراجع أو تنجح verification غير مفعلة. | `quality-scan-solution-evidence` | `COMPLETE_VERIFIED` |
| 28 | Snapshots | byte snapshot واسترجاع بعد تأكيد مع أثر واضح. | الاسترجاع مقيد ولا يترك أثر fixture دائم. | `quality-snapshot-evidence` | `COMPLETE_VERIFIED` |

## أدوات المطور وGit المحلي

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 29 | Terminal | اختيار وتنفيذ commands مكتشفة فقط من المشروع الموثوق؛ output يتبع task. | لا shell حر ولا تنفيذ في مشروع غير موثوق. | `developer-git-surface-evidence`، `server/routes/workspace.spec.ts` | `COMPLETE_VERIFIED` |
| 30 | Tests Center | يشغّل test command المكتشف ويحتفظ stdout/stderr/result. | failure يعرض `Test failed` ودليله، لا نتيجة نجاح موحدة. | `developer-git-surface-evidence` | `COMPLETE_VERIFIED` |
| 31 | Build Center | يشغّل build المكتشف ويعرض مخرج build الفعلي. | build الغائب أو الفاشل يبقى نتيجة موثقة. | `developer-git-surface-evidence` | `COMPLETE_VERIFIED` |
| 32 | Runtime Center | runtime مقيد عبر executable محلي، probe HTTP، وتنظيف process tree في Windows. | script/runtime الغائب يعرض عدم توافره؛ لا `shell:true` مخفي. | `developer-git-surface-evidence`، `server/routes/workspace.spec.ts` | `COMPLETE_VERIFIED` |
| 33 | Logs | task logs ومخرجات الأمر الفعلية قابلة للمراجعة في Logs. | لا سجل نجاح قبل إتمام المهمة. | `developer-git-surface-evidence` | `COMPLETE_VERIFIED` |
| 34 | Diagnostics | قياسات محلية لقدرات الأدوات مع Refresh يعيد فحص الدليل المحلي فقط. | أداة غير مثبّتة ظاهرة كـ`UNAVAILABLE`. | `system-diagnostics-evidence` | `COMPLETE_VERIFIED` |
| 35 | Preview السياقي | مالك Preview واحد يستقبل سياقات المشروع ولا ينشئ محرك معاينة موازياً. | دليل/حزمة المعاينة الغائبة حالة صريحة. | `workspace-acceptance`، `release-evidence` | `COMPLETE_VERIFIED` |
| 36 | Git المحلي | status/diff/history والعمليات المقيدة محلياً مرتبطة بـGit fixture حقيقي. | trust وconfirmation وحصر المسار يمنعان العملية قبل تغيير Git. | `git-local-operations` | `COMPLETE_VERIFIED` |
| 37 | Branches | إنشاء branch محلي موثوق وعرضه الحقيقي في المستودع. | branch غير صحيح أو غير موثوق يفشل صراحة. | `git-local-operations`، `developer-git-surface-evidence` | `COMPLETE_VERIFIED` |
| 38 | Commits | stage/unstage/commit محلي بعد confirmation مع رسالة ودليل status. | remote push يظل `NOT_PERFORMED` في هذا المسار. | `git-local-operations` | `COMPLETE_VERIFIED` |

## التكاملات البعيدة والإصدار

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 39 | GitHub التكامل الصادق | واجهة المنتج تملك عرض حالة المحول وسياسة المنصة. | لا اعتماد/سياسة/endpoint للمنتج: `NOT_CONFIGURED` أو `BLOCKED`، من دون بيانات GitHub بديلة. | `online-control-center-evidence`، `ZERO_DEAD_UI_MOCK_AUDIT.md` | `BLOCKED_BY_EXTERNAL_CONFIGURATION` |
| 40 | Pull Requests | السطح معدّ للقراءة عبر محول GitHub فقط. | يلزم اعتماد وسياسة ومصدر GitHub حقيقيان؛ لا PR وهمي. | `online-control-center-evidence` | `BLOCKED_BY_EXTERNAL_CONFIGURATION` |
| 41 | Issues | السطح معدّ للقراءة عبر محول GitHub فقط. | يلزم اعتماد وسياسة ومصدر GitHub حقيقيان؛ لا Issue وهمي. | `online-control-center-evidence` | `BLOCKED_BY_EXTERNAL_CONFIGURATION` |
| 42 | Actions | السطح معدّ لقراءة حالة CI من المحول المهيأ. | نجاح CI التطويري أعلاه لا يهيئ محول المنتج؛ لذلك لا يعرض المنتج run عن بعد. | `release-evidence`، `online-control-center-evidence` | `BLOCKED_BY_EXTERNAL_CONFIGURATION` |
| 43 | Releases | السطح معدّ لقراءة إصدار GitHub من المحول المهيأ. | لا release خارجي أو تنزيل دون تهيئة صريحة. | `online-control-center-evidence` | `BLOCKED_BY_EXTERNAL_CONFIGURATION` |
| 44 | Release Gate | يجمع مصادر `SOURCE` و`LOCAL` و`PREVIEW` و`DESKTOP` و`WINDOWS_PACKAGE` و`INSTALLER` بصورة مستقلة. | `CI`/`GITHUB`/`REMOTE` تبقى منفصلة وغير جاهزة بلا دليل المنتج؛ الحزمة الموثقة `UNSIGNED`. | `release-evidence` | `COMPLETE_VERIFIED` |
| 45 | Release Preparation | معاينة محلية للنسخة وnotes/artifacts بلا كتابة بعيدة. | لا نشر أو وسم أو artifact CI مزعوم من الواجهة المحلية. | `release-evidence` | `COMPLETE_VERIFIED` |
| 46 | Artifacts | يقرأ artifact محلياً ويفصل SHA المحلي عن هوية CI وملف المثبت. | لا يخلط SHA محلي مع artifact/CI بعيد. | `release-evidence` | `COMPLETE_VERIFIED` |
| 47 | Versioning | مصدر `package.json` والـbaseline والـartifact يعرضون هوياتهم المنفصلة. | عدم تطابق المصدر أو غياب artifact يظل finding قابل للمراجعة. | `release-evidence`، `DEPENDENCY_AND_TOOLCHAIN_AUDIT.md` | `COMPLETE_VERIFIED` |

## البحث، الإتاحة، والضوابط الختامية

| # | القدرة | المالك الفعلي والسلوك المتحقق | الفشل/الحد الصادق | الدليل الموجّه | الحالة |
|---:|---|---|---|---|---|
| 48 | Global Search | بحث محلي عبر entities محددة، coverage count، وانتقال للنتيجة إلى surface الصحيح. | المصدر غير المفحوص يظهر تغطيته وحدوده ولا يتحول إلى عدم وجود. | `global-search-evidence` | `COMPLETE_VERIFIED` |
| 49 | Command Palette | Ctrl/Cmd+K، البحث، تنفيذ command فعلي، إغلاق Escape، وحبس/استعادة تركيز. | لا نتيجة محلية تعرض «لا نتيجة» مع coverage، لا no-op مخفي. | `global-search-evidence`، `accessibility-keyboard-evidence` | `COMPLETE_VERIFIED` |
| 50 | Accessibility | تسميات، عنوان Actions لقارئات الشاشة، focus visible، traps واستعادة focus في الحوارات. | نطاق Axe محدد لثلاثة أسطح؛ لا ادعاء اعتماد WCAG كلي. | `accessibility-keyboard-evidence`، `DYNAMIC_UI_AND_ACCESSIBILITY_AUDIT.md` | `COMPLETE_VERIFIED` |
| 51 | أداء المشروع الكبير | fixture/benchmark حقيقيان بحدود 2,000/5,000 ملف وقياس cache/RSS. | النتائج محلية للجهاز والتاريخ الموثقين فقط. | `performance.spec.ts`، `LARGE_PROJECT_BENCHMARK.md` | `COMPLETE_VERIFIED` |
| 52 | Final Self Audit | تسلسل KForge-on-KForge رصدي، persistence ذري، و`WAITING_RESTART` لا يكتمل إلا بمثيل خادم آخر. | لا يخلط reload renderer مع restart، ولا يسمح source mutation غير مفسر. | `self-audit-run-evidence`، `server/services/selfAudit.spec.ts` | `COMPLETE_VERIFIED` |

## نتيجة التدقيق النهائي وحدود الدليل

يملك كل صف محلي في المصفوفة الآن سلوكاً منشوراً ومسار فشل صادقاً ودليلاً محدداً. وقد تأكد التدقيق الديناميكي، بدلاً من افتراض ذلك من الشفرة، من فتح **66 وجهة منشورة** بلوحة المفاتيح في إنتاج محلي ومن بقاء سطح نشط واحد فقط. ويحظر تدقيق الواجهات الصفرية اعتبار fixtures أو مكونات غير موجهة مصادر منتج، ولا يعلن تنزيلات أو تقييمات أو نماذج أو مزودي AI أو تنفيذ GitHub أو نجاح CI من بيانات وهمية.

تبقى القيود التالية خارج الإغلاق المحلي ويجب عدم ترقيتها بلا دليل مستقل: **اعتمادات GitHub ومحول المنتج البعيد، موفرو الذكاء السحابي، توقيع Code Signing وSmartScreen، وإثبات جهاز Windows نظيف أو Sandbox**. كما يسجل [تدقيق الاعتماديات والأدوات](./DEPENDENCY_AND_TOOLCHAIN_AUDIT.md) أن production audit بلا ثغرات، فيما تبقى ملاحظتا React Router المتوسطتان في شجرة dev وتتطلبان ترقية رئيسية متعمدة إلى v7؛ لا توصف هذه النتيجة بأنها صفر ثغرات في الشجرة الكاملة.
