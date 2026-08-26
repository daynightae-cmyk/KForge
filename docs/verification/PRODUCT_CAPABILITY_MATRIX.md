# مصفوفة قدرات منتج KNOuX Forge

**مرجع البدء:** `4290a272797a71ce7c4c515d9edbaec730258c49` على `main`
**الغرض:** فصل التنفيذ القابل للقياس عن الواجهة المعروضة وعن الحالات المتصلة التي تتطلب إعدادًا خارجيًا. لا تعني الشاشة المعروضة وحدها حالة `COMPLETE_VERIFIED`.

## دلالات التصنيف

| الحالة | المعنى |
|---|---|
| `COMPLETE_VERIFIED` | توجد بيانات أو عملية حقيقية، ومعالجة فشل صادقة، واختبار مصدر أو تشغيل مناسب. |
| `PARTIAL` | يوجد مسار حقيقي، لكن تغطية القبول أو السلوك المنتج النهائي ما زال ناقصًا. |
| `UI_ONLY` | توجد واجهة، لكن لا يوجد دليل كافٍ على مالك بيانات أو عملية حقيقية. |
| `BACKEND_ONLY` | توجد خدمة أو عقد، لكن لا يوجد سطح منتج موثق لها. |
| `UNAVAILABLE` | عدم الإتاحة هو النتيجة الصحيحة في البيئة المحلية الحالية. |
| `NOT_IMPLEMENTED` | يلزم تنفيذ محلي جديد. |
| `BLOCKED_BY_EXTERNAL_CONFIGURATION` | يتطلب هذا السلوك بيانات اعتماد أو سياسة أو موفرًا أو اتصالًا لم يتم توفيره. |

## لقطة التدقيق قبل الإكمال

| # | مجموعة القدرة | حالة البداية | حقيقة المصدر الحالية | الدليل المطلوب للإغلاق |
|---:|---|---|---|---|
| 1 | قشرة Workspace والتنقل | `COMPLETE_VERIFIED` | شريط جانبي ورأس ثابت وسطح نشط واحد وخرائط عرض لجميع عناصر التنقل. | اختبار جميع الانتقالات وعدم وجود renderer مفقود. |
| 2 | مشاريع Workspace | `PARTIAL` | اكتشاف محلي وفتح وفرز وبحث وفلاتر واختيار وإجراءات جماعية موجودة. | اختبار قبول حقيقي للفرز والفلاتر والاختيار وفتح مشروع. |
| 3 | Recent / Favorites / Pinned / Archive | `PARTIAL` | تخزين مجموعات محلي وواجهات العرض موجودة. | اختبار تغيير واستمرار كل مجموعة. |
| 4 | Settings Center | `PARTIAL` | إعدادات عامة ومظهر وخصوصية ومعاينة ذات تخزين حقيقي؛ مجالات أخرى مصنفة. | تدقيق كل عنصر تحكم مرئي وحفظه وإعادة تشغيله وأثره التشغيلي. |
| 5 | أوضاع التشغيل | `PARTIAL` | Offline وLocal-first وOnline Optional وOnline وسياسات مستقلة موجودة. | اختبار تغيير الوضع وقيود الشبكة الظاهرة. |
| 6 | Online Control Center | `PARTIAL` | عقد تحكم وتفاصيل توفر محلية موجودة. | اختبار حالات عدم التهيئة وعدم إجراء اتصال تلقائي. |
| 7 | Online Hub | `PARTIAL` | ثلاث مناطق محلية و14 قسمًا وفلترة وبحث ومفتش موجودة. | اختبار الأقسام والحالات الصادقة لكل مصدر. |
| 8 | Marketplace discovery | `PARTIAL` | سجل أولي محلي وLifecycle مثبت موجودان. | اختبار التثبيت/الصحة/التحديث/الإزالة في سطح المنتج. |
| 9 | Extensions | `PARTIAL` | قسم حقيقي يعتمد على سجل Marketplace المحلي. | إثبات الحالة الفارغة أو العناصر المحلية بلا بيانات مصطنعة. |
| 10 | Model Hub | `PARTIAL` | رصد Ollama وتوافق الأجهزة ونماذج محلية موجودة. | اختبار رصد runtime حقيقي وحالة غير مهيأ. |
| 11 | AI Providers | `PARTIAL` | رصد مفاتيح ومزودين محليين مع إخفاء أسرار موجود. | اختبار `CONFIGURED` مقابل `NOT_CONFIGURED` وعدم تسريب الأسرار. |
| 12 | Agents | `PARTIAL` | Mission orchestrator وأدوات وصلاحيات وأدلة موجودة. | قبول مهمة حقيقية مقيدة ومراجعة حالات الاسترداد. |
| 13 | Mission Engine UX | `PARTIAL` | تخطيط ومراحل وأدلة ومحاولات واسترجاع موجودة. | اختبار واجهة إنشاء/إيقاف/إعادة/استئناف مهمة. |
| 14 | Task Center | `PARTIAL` | مهام دائمة وتحكم cancel/retry/resume/rollback موجودة. | اختبار انتقالات الحالة في واجهة تشغيلية. |
| 15 | Project Graph | `PARTIAL` | رسم بياني محدود وأدلة وذاكرة مؤقتة موجودة. | اختبار قبول لرسم مشروع fixture وعرض التغطية. |
| 16 | Dependencies | `PARTIAL` | كشف manifests واعتماديات محلية موجود. | اختبار عرض واعتماد مصدر لكل سجل. |
| 17 | Impact Analysis | `PARTIAL` | استعلامات graph وعقود مصدر متاحة. | اختبار أثر symbol حقيقي وعدم اختلاق نتائج. |
| 18 | Code Understanding | `PARTIAL` | profile وgraph وsource roots وAPIs مقاسة. | اختبار سطح المنتج لملف fixture متعدد الأنواع. |
| 19 | Ask KForge | `PARTIAL` | إجابة قواعد محلية أو Local AI مع شفافية موجودة. | اختبار طلب قواعد وحالة Local AI غير المهيأ. |
| 20 | Architecture Center | `PARTIAL` | حدود ووحدات ودورات وقيود محلل موجودة. | اختبار عرض الأدلة والقيود لمشروع حقيقي. |
| 21 | KForge Sonar | `PARTIAL` | فحص محلي ومشكلات مصنفة ودليل موجود. | اختبار scan من السطح وتحديث النتائج. |
| 22 | Problems | `PARTIAL` | عرض مشكلات scanner حقيقية موجود. | اختبار تصفية الأدلة والانتقال من البحث. |
| 23 | Solutions | `PARTIAL` | حلول آلية فقط عند patch محدد ومسار Snapshot/Verify موجود. | اختبار حالة لا توجد لها حلول آلية وحالة آمنة محددة. |
| 24 | Security Center | `PARTIAL` | أدوات أمنية محلية مع حالة availability موجودة. | اختبار عدم تشغيل أداة غير متاحة وشفافية التشغيل. |
| 25 | Performance | `PARTIAL` | scanner وbenchmark لمشروع كبير موجودان. | تشغيل benchmark واعتماد عرض أدلة الأداء. |
| 26 | Technical Debt | `PARTIAL` | اشتقاق من اكتمال وجودة وتعقيد ومعمارية موجود. | اختبار التصنيف مع أدلة مصدر. |
| 27 | Documentation | `PARTIAL` | audit توثيق محلي موجود. | اختبار discovery وعرض فجوة موثقة. |
| 28 | Snapshots | `PARTIAL` | إنشاء واسترجاع بعد تأكيد ومسار آمن موجودان. | اختبار إنشاء واسترجاع fixture بدون آثار دائمة. |
| 29 | Terminal | `PARTIAL` | تشغيل أوامر مكتشفة فقط، بلا shell حر، موجود. | اختبار الأدوات ورفض المشروع غير الموثوق. |
| 30 | Tests Center | `PARTIAL` | تنفيذ test محلي وتسجيل stdout/stderr موجود. | قبول تنفيذ fixture وأدلة نتيجة. |
| 31 | Build Center | `PARTIAL` | تنفيذ build مكتشف وتسجيل دليل موجود. | قبول تنفيذ fixture وأدلة نتيجة. |
| 32 | Runtime Center | `PARTIAL` | فحص runtime مقيد ومسار Preview موجود. | قبول تنفيذ runtime أو حالة غير متاحة صادقة. |
| 33 | Logs | `PARTIAL` | سجلات tasks ومخرجات فعليّة معروضة. | اختبار ظهور task مكتمل وسجل إخراج. |
| 34 | Diagnostics | `PARTIAL` | فحص محلي وSystem Diagnostics موجودان. | اختبار حالة tool غير متاحة وتحديثها. |
| 35 | Preview السياقي | `COMPLETE_VERIFIED` | مالك Preview واحد وسطح مشترك ودورة مثبتة حقيقية موجودة. | استمرار اختبار السياقات وعدم إنشاء محرك ثانٍ. |
| 36 | Git المحلي | `PARTIAL` | status/diff/branches/history/pre-push وcreate branch موجودة؛ واجهة stage/unstage/commit/pull/push غير مكتملة. | تنفيذ مسارات Git المحلية المتبقية مع تأكيدات. |
| 37 | Branches | `PARTIAL` | إنشاء فرع محلي وعرض branches موجودان. | اختبار branch آمن على fixture. |
| 38 | Commits | `PARTIAL` | history وSmart Commit preview فقط؛ لا إنشاء commit في الواجهة. | تنفيذ commit محلي مقيد أو تصنيف عدم الإتاحة. |
| 39 | GitHub التكامل الصادق | `BLOCKED_BY_EXTERNAL_CONFIGURATION` | قراءة فقط عند وضع وسياسة وبيانات اعتماد مناسبة؛ لا بيانات مزيفة. | تهيئة صريحة وقراءة حقيقية، أو عرض blocker. |
| 40 | Pull Requests | `BLOCKED_BY_EXTERNAL_CONFIGURATION` | قراءة موفر GitHub فقط. | بيانات اعتماد وسياسة وendpoint حقيقيان. |
| 41 | Issues | `BLOCKED_BY_EXTERNAL_CONFIGURATION` | قراءة موفر GitHub فقط. | بيانات اعتماد وسياسة وendpoint حقيقيان. |
| 42 | Actions | `BLOCKED_BY_EXTERNAL_CONFIGURATION` | قراءة موفر GitHub فقط. | بيانات اعتماد وسياسة وendpoint حقيقيان. |
| 43 | Releases | `BLOCKED_BY_EXTERNAL_CONFIGURATION` | قراءة موفر GitHub فقط. | بيانات اعتماد وسياسة وendpoint حقيقيان. |
| 44 | Release Gate | `PARTIAL` | مصادر Local/GitHub/CI/Preview منفصلة؛ لا تقسيم Desktop/Windows Package/Installer واضح. | دمج أدلة سطح المكتب والحزم والسياسة الزمنية وSHA. |
| 45 | Release Preparation | `PARTIAL` | معاينة محلية للنسخة وnotes وartifacts دون كتابة. | سياسة artifact محلية/CI وحقول المصدر والهاش. |
| 46 | Artifacts | `PARTIAL` | artifact محلي موجود لكن لا فصل صريح عن CI. | عرض Local/CI ببيانات SHA مستقلة. |
| 47 | Versioning | `PARTIAL` | package.json وbaseline tag ظاهران. | اختبار توافق مصدر النسخة والartifact. |
| 48 | Global Search | `PARTIAL` | بحث محلي محدود وعقود coverage موجودة. | قبول بحث وتنقل إلى result وإظهار حدود التغطية. |
| 49 | Command Palette | `PARTIAL` | أوامر حقيقية وCtrl/Cmd+K وإغلاق موجودة. | اختبار تنفيذ الأوامر وعدم وجود no-op. |
| 50 | Accessibility | `PARTIAL` | labels وlive status وkeyboard table موجودة. | مسح آلي للـARIA ولوحة المفاتيح للسطوح الرئيسية. |
| 51 | أداء المشروع الكبير | `PARTIAL` | benchmark وذاكرة graph المؤقتة موجودان. | قياس موثق في بوابة القبول. |
| 52 | Final Self Audit | `PARTIAL` | orchestration ومثابرة وإعادة تحميل بعد restart موجودة. | تشغيل دورة متحكم بها وتسجيل أدلتها. |

## فجوات محلية ذات أولوية

1. **Git المحلي** يحتاج stage/unstage وcommit وpull وpush ضمن واجهة مقيدة بتأكيدات، لا مجرد عرض حالة.
2. **Release Gate وArtifacts** يحتاجان فصلًا صريحًا بين أدلة المصدر المحلي، سطح المكتب، حزمة Windows، المثبت، وبنية CI البعيدة، مع عدم خلط SHA محلي وCI.
3. **اختبارات القبول الحية** تحتاج توسيعًا من تسلسل تنقل مختصر إلى تفاعل واقعي مع collections والإعدادات وOnline Hub وGit المحلي وذكاء المشروع والجودة والأوامر.
4. **تدقيق الصفر UI/Mock** يحتاج سجلًا مصنفًا لكل تطابق إنتاجي بدل إزالة fixtures أو رسائل عدم الإتاحة الصادقة.

> تُحدَّث هذه المصفوفة بعد كل مجموعة قدرة. لا تتحول حالة `PARTIAL` إلى `COMPLETE_VERIFIED` إلا عند وجود تنفيذ تشغيلي واختبار موجه مناسب.

## تحديث التنفيذ والقبول — 26 أغسطس 2026

| مجموعة القدرة | الحالة بعد التوسعة | الدليل التشغيلي والاختبار | الحدود المتبقية |
|---|---|---|---|
| مشاريع Workspace (#2) | `COMPLETE_VERIFIED` | `workspace-table-evidence.spec.ts` يثبت البحث والفرز والاختيار الجماعي والمسح على جدول الإنتاج. | لا توجد عملية حذف مشروع من هذا السطح؛ فتح المشروع وحدود الثقة باقية مقصودة. |
| Recent / Favorites / Pinned / Archive (#3) | `COMPLETE_VERIFIED` | `workspace-acceptance.spec.ts` يثبت الإضافة، التثبيت، الأرشفة، الاستعادة، والإزالة عبر الإجراءات المرئية وبطاقات المجموعات. | السجل معزول تحت جذر E2E؛ لا يُستخدم لإثبات مزامنة بعيدة. |
| Online Control Center وOnline Hub (#6–#9) | `PARTIAL` مع قبول حالة Offline | `product-surface-evidence.spec.ts` يفتح Marketplace، يختار تصنيف Models محليًا، ويتحقق من عدم وجود طلب HTTP خارجي أو خطأ API/صفحة. | حالات المزود الخارجي والتثبيت البعيد تتطلب سياسة ومحولًا ومصدرًا مهيأً. |
| AI Providers وProject Graph وKForge Sonar (#11، #15، #21) | `PARTIAL` مع قبول أدلة محلية | قبول الإنتاج يفتح السطوح الثلاثة، ويثبت ظهور دليل موفر/محلي/عدم إتاحة صريح، حقل تحليل أثر حقيقي، وأدلة جودة محلية بلا أخطاء. | اختبار مزود AI حقيقي أو تحليل runtime يتطلب runtime/اعتماد/مشروع fixture مناسب. |
| Git المحلي (#36، #38) | `COMPLETE_VERIFIED` للنطاق المحلي المنفذ | أضيفت مسارات وواجهة `stage` و`unstage` و`commit` مع ثقة وتأكيد ومسارات نسبية آمنة. `git-local-operations.spec.ts` يثبت حظر غير الموثوق، رفض traversal، التجهيز، الإلغاء، الإيداع، و`Remote push: NOT_PERFORMED` في مستودع مؤقت. | pull/push متعمدان خارج هذا السطح المحلي؛ عمليات GitHub تبقى مقيدة بسياسة واعتماد صريحين. |
| Release Gate وRelease Preparation وArtifacts (#44–#47) | `COMPLETE_VERIFIED` لفصل الدليل المحلي | عقد مصادر مستقلة: `SOURCE` و`LOCAL` و`PREVIEW` و`DESKTOP` و`WINDOWS_PACKAGE` و`INSTALLER` و`GITHUB` و`CI` و`REMOTE`. يقرأ السطح فقط ملفات دليل محلية مسجلة، ويعرض التوقيع والـSHA المحليين بلا استبدالهما بهوية CI. `release-evidence.spec.ts` يثبت API والواجهة. | `CI` وGitHub وREMOTE لا تصبح READY إلا بدليل مهيأ وحقيقي؛ الحزمة الحالية `UNSIGNED` بوضوح. |
| Command Palette (#49) | `COMPLETE_VERIFIED` | `workspace-acceptance.spec.ts` يثبت Ctrl+K وEscape وعدم تكديس سطح نشط. | البحث الشامل يبقى محدودًا بتغطية المصدر المعلنة. |
| تدقيق واجهات وهمية/ميتة | `COMPLETE_VERIFIED` | راجع [ZERO_DEAD_UI_MOCK_AUDIT.md](./ZERO_DEAD_UI_MOCK_AUDIT.md) المسارات المنشورة، حالات عدم الإتاحة، ولغة الفاحص، والمكونات غير الموجهة. | محرر الفيديو القديم غير الموجه دين تقني معزول، وليس قدرة KForge منشورة. |

> لا تغير هذه التحديثات حالة GitHub وCI والتوقيع وSmartScreen وبيئة Windows النظيفة ومزودي AI البعيدين. تظل تلك الحالات `BLOCKED_BY_EXTERNAL_CONFIGURATION` أو `UNAVAILABLE` إلى أن يتاح دليل مستقل وحقيقي.
