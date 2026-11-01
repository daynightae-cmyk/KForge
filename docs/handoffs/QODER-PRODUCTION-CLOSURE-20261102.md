بسم الله والصلاة والسلام علي رسول الله صلي الله عليه وسلم

# QODER — KForge: استكمال فعلي لحد production بدليل

أنت principal implementation engineer للمشروع. المطلوب تنفيذ النواقص وإثباتها، مش إعادة كتابة تقرير أو تصميم بديل. اشتغل على الواقع الحالي، احفظ الشغل الفريد، وكمّل كل مسار مسموح وممكن للنهاية. ما توعدش بإنجاز لاحق ولا تعتبر نجاح build دليل على production.

## 1. نقطة البداية الملزمة

- المشروع الوحيد في المهمة: KForge، المستودع `daynightae-cmyk/KForge`.
- المسار canonical: `K:\Knoux Projects\KForge\Base`.
- `K:\Knoux Projects\KForge` مجلد تنظيم وليس Git root.
- اقرأ `AGENTS.md` ثم `docs/verification/2026-11-02-integration/AUDIT.md` و`RESULTS.md`.
- اقرأ `SURFACE-INVENTORY.md` وملفات refs/content comparison قبل أي قرار يخص بقايا الفروع.
- راجع `docs/research/recovered-20261017/RECOVERY-MANIFEST.json` لو احتجت المصدر التاريخي.
- اقرأ آخر مخرجات `K:\Knoux Projects\KForge\Evidence\integration-audit-20261102`؛ أي ملف ناقص أو نتيجة ما اكتملتش تبقى UNVERIFIED.
- راجع HEAD وorigin/main مباشرة؛ الشواهد دي dated snapshot بتاريخ 2026-11-02 بتوقيت دبي، مش حقيقة متجددة تلقائيًا.
- ما تبدأش باختراع architecture جديدة أو إعادة audit شامل لنفس النقاط من الصفر. نفّذ فحص الحالة القصير، وبعده أول إصلاح مثبت.

## 2. ما تم فعلًا ومعنى الدمج

تم حفظ 18 وثيقة مهمة محلية في Git، دمج README والرسومات الفريدة بدمج عادي، ودمج upstream main المحدث. تم تعديل 10 مواضع temporary fixtures إلى `os.tmpdir()` بدل تلويث checkout. تم حفظ 66 ملف بحث ومصدر من Recovery مع hashes.

يوجد دمجان ancestry-only: `c843413` للفروع التي اتجاوزتها تطبيقات main، و`6266db1` للـstashes التاريخية. معناهما حفظ تاريخ ومصدر قابل للرجوع، **وليس تشغيل كل الكود القديم داخل المنتج**. لا تستخدم وجود commit كـancestor لإثبات قدرة runtime. لا تعِد Edita/starter/demo أو تبدل المزود الحالي بتطبيق vault أقدم.

الـOpenSumi source داخل docs/research مرجع تاريخي فقط. لا تشغّل سكربتاته، لا تثبّت dependencies بتاعته ضمن KForge، ولا تنقل shell التجربة للمنتج. أي migration جديدة محتاجة نطاق منفصل ودليل وموافقة صاحب المشروع.

## 3. فحص الحالة القصير ثم التنفيذ

سجل root/branch/HEAD/status/staged/untracked/worktrees/stash وupstream divergence. افحص وجود Git operation غير مكتملة. حدّث origin refs بعد إعلان ذلك. افحص PRs وCI على SHA النهائي. تحقق من العمليات النشطة قبل لمس أي worktree.

الأوامر تُستخرج من package.json الحالي، مش من الملف ده وحده. لا تعمل reset أو إعادة كتابة تاريخ أو حذف شغل عشان يظهر المستودع نظيف. اعزل أي تغيير موازي؛ ما توقفش عملية تخص مشروع آخر.

كل finding يخرج من PLANNED إلى IMPLEMENTED ثم VERIFIED بدليل مناسب. لو في blocker خارجي، خلّص الشغل المستقل، وسجل السبب والخطوة المطلوبة بدقة.

## 4. قواعد الحفاظ والمعمارية

احفظ المسار الحالي:

`React workbench -> typed shared contracts -> allowlisted Electron preload/IPC -> main process/local Express -> canonical services -> actual provider/native effects`.

نقاط الارتكاز:

- `client/App.tsx` routing.
- `client/workbench/KForgeWorkbench.tsx` persistent shell.
- `client/workbench/navigation.ts` activity/view registry.
- `client/workbench/serviceDirectory.ts` service mapping.
- `client/workbench/*Surface.tsx` الواجهات المتخصصة.
- `client/components/ui/KForgeInspector.tsx` وملكية الـInspector الحالية.
- `server/index.ts` وتجميع المسارات الحالية.
- `shared/` العقود المشتركة.
- `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/githubConnect.cjs`.

Online له Explorer scoped داخل المجال. لا تفرد الأبناء في global Activity Bar ولا تعمل Marketplace/AI/GitHub shell موازية. حافظ على handlers الحقيقية، persistence، policy، audit evidence، disabled reasons وحالات الخطأ.

## 5. أولوية P0 التشغيلية: آخر checks ودمج main

اقرأ RESULTS وحدد هل push تم وهل exact final main CI اكتمل. نجاح f1c872f القديم لا يثبت commit أحدث. لو فيه فشل سببه الدمج، أصلحه الأول واختبره. متضعفش tests ولا تغير expected strings لمجرد تمريرها من غير مراجعة الحقيقة التي بتحميها.

أي direct push يترفض بسبب حماية الفرع يُعالج بالمسار المشروع للـPR، بدون force أو تعطيل حماية. لا تنشئ PR مكرر. بعد الدمج حدّث canonical main وافحص الشجرة مرة ثانية. لا تعتبر push هو merge أو deployment.

## 6. أولوية P1: صدق تغطية agent context

أضف قبل الإغلاق تشخيص Windows الفعلي: اختبار provider command-center فشل مرتين، إحداهما isolated مع maxWorkers=1، بسبب `protectWithDpapi` وPowerShell ETIMEDOUT عند 10 ثوانٍ. Preview وTopology نجحوا في الإعادة المعزولة (28 passed، وفشل vault واحد). فحص Electron source smoke فشل بمهلة 120 ثانية. لا تعتبر ده نقص test فقط ولا تحوّل vault إلى plaintext أو fake backend للإنتاج. افصل deterministic unit seam عن اختبار DPAPI الفعلي، وشخّص startup/process/log evidence وأصلح السبب، وبعدها أعد native acceptance.

العيب المثبت في `server/services/agent.ts` داخل `collectProjectFiles`: catch بتاع `fs.readdir` بيرجع من غير complete=false، فـmissing/unreadable subtree ممكن يظهر complete.

نفّذ أصغر تعديل كامل:

1. أضف metadata واضحة للـunreadable/failed paths بدون تسريب بيانات حساسة.
2. أي root/subtree تعذر قراءته يغيّر completion truth إلى partial/failed حسب العقد.
3. حافظ على نتائج الملفات المتاحة بدل فقدها أو اختلاق اكتمال.
4. مرر الحالة إلى `buildAgentContext` وعرض coverage في الواجهة/Inspector.
5. تحقق من الـmaxFiles/maxDepth/time budget ومن semantics عند بلوغ الحد.
6. لا تقدم time checks بين fs calls باعتبارها cancellation فعلية.
7. اختبر missing root، mock readdir failure، disappearing subtree، skipped links، tree كبير، budget exhaustion ونجاح tree صغير.
8. راجع safeFile/realpath guards وتبديل الرابط أثناء الكتابة؛ لا تضعف containment.

استخدم `server/services/agent-context-bounds.test.ts` والاختبارات المرتبطة كنقطة بدء. Windows permission tests قد تتصرف مختلفًا مع صلاحيات المستخدم؛ اعمل deterministic injected failure واختبار منصة منفصل لو متاح. اثبت النتيجة والسلوك downstream، مش بس عدد tests.

## 7. أولوية P1: GitHub Connect الحقيقي

المصدر موجود تحت `apps/github-connect`. ده server-only Node 24 backend، مش صفحة frontend. فحص Vercel في جلسة الدمج رجّع project موجود، صفر deployments، live=false. الدومين attached/verified في dedicated listing لكن health من الجهاز فشل DNS. راجع الواقع مرة جديدة ولا تعتبر domain verification تشغيل.

راجع:

- `apps/github-connect/README.md` للإعداد والعقود الفعلية.
- `api/index.mjs`, `src/router.mjs`, `src/crypto.mjs`, `src/github.mjs`, `src/store.mjs`.
- `desktop/githubConnect.cjs` وUI `GitHubConnectPanel.tsx` وIPC ownership.
- `apps/github-connect/vercel.json` وRoot Directory `apps/github-connect`.
- Node 24.x، framework Other/null، عدم وجود frontend build/output.
- production branch/repository link يطابقان النسخة المعتمدة فعليًا.

لا تضع Client Secret، Webhook Secret، encryption key، Redis token أو session proof في Git أو renderer أو logs أو التقرير. افحص وجودها وصحتها من القنوات المحمية. key موجود لا يعني policy صحيحة أو durable store سليم.

قبل نشر أو تعديل DNS/secrets تأكد من تفويض هذه الخطوة تحديدًا. مهمة audit/integration لا تسمح تلقائيًا بتفعيل Webhook أو دفع رسوم أو تغيير نطاقات أخرى. جهّز الشغل المحلي والنتيجة القابلة للمراجعة أولًا، وسجّل blocker لو محتاج owner credentials/authorization.

عند توفر التفويض والبيئة:

1. اربط المشروع الصحيح، دون إنشاء مشروع منافس.
2. تحقق من durable Redis الحقيقي: TLS، TTL، GETDEL، CAS، rate limit، replay store. لا in-memory fallback للإنتاج.
3. تحقق من encryption at rest وسلوك key rotation وانقطاع store بدون طباعة secrets.
4. صحح DNS للدومين المحدد فقط وفق الإعداد الفعلي؛ تحقق من resolution وTLS وhealth.
5. طابق deployment SHA مع accepted source وراجع build/runtime logs.
6. health=READY يحتاج config كامل وstore PING، وليس HTTP 200 شكلي.
7. نفّذ owner OAuth حقيقي: start، browser، state أحادي الاستخدام، PKCE، callback، identity، pairing proof وعدم تسريب tokens.
8. اختبر refresh/revocation، انقطاع الشبكة، انتهاء الجلسة، concurrent refresh/disconnect، replay وinvalid signature.
9. اختبر Windows installed flow: safeStorage encryption/persistence/restart، origin/IPC restrictions، offline policy.
10. لا تعلن production verified إلا بدليل هذا المسار، وليس 17 synthetic tests فقط.

## 8. أولوية P2: pagination وinstallation authorization

المصدر الحالي يقرأ أول 50 installation، ويتحقق من السماح لأول 100، ويرجع أول 50 repository. ده يرفض installation شرعية في صفحة متأخرة، ويخفي بقية القوائم.

نفّذ pagination bounded بعقد واضح:

- cursor/page input يتم التحقق منه وعدم السماح بتمرير arbitrary GitHub URL.
- server-side next-page parsing مع allowlisted origin/path.
- pagination/completeness metadata تفرق بين complete وpartial وrate-limited.
- تحقق ملكية installation عبر صفحات وصول المستخدم مع حد آمن؛ لو الحد اتنفد يرجع partial/unknown reason، مش denial مضلل.
- UI load-more/empty/retry وحفظ الاختيار بدون optimistic truth.
- اختبارات multi-page وlate-page authorization و403 و429 وmalformed response وtimeout وduplicate IDs وcancellation.

راجع حدود response bytes/arrays، version headers وleast privilege. لا تخلط sign-in مع منح صلاحية Git mutation على مشروع.

## 9. أولوية P2: webhook من receipt إلى workflow حقيقي

حاليًا signed webhook بيتسجل مرة واحدة؛ ده ليس repository sync. حدد المنتج بصدق: لو feature معلن كـreceipt فقط يبقى النص واضح؛ لو synchronization مطلوب نفّذه عبر engines الحالية.

للتنفيذ الحقيقي يلزم durable event/job state، delivery/event allowlist، installation-to-user/project binding، idempotency، retries bounded وdead-letter، observability وdesktop delivery/polling مناسب. حافظ على الفصل بين receipt، scheduled، running، failed، synchronized.

لا تعمل auto pull/push/overwrite لمجرد وصول حدث. trust وauthority وbranch/conflict state تحدد eligibility. افحص dirty working tree قبل أي mutation واحفظ unique work. اختبر duplicate/out-of-order events، invalid HMAC، delivery replay، unavailable queue/store، revoked installation وانقطاع الجهاز.

## 10. أولوية P1/P2: dependency security بدون تكسير التغليف

اقرأ `npm-audit.json` وحدثه. في snapshot: 14 moderate، صفر high/critical، production-only audit صفر. ما تختزلش ده إلى all dependencies clean، ولا تعتبر development chain غير مهمة للتغليف.

راجع electron-builder وasar/universal/glob/minimatch، typography/postcss-selector-parser، sucrase. بعض fixes المقترحة downgrade قديم جدًا؛ لا تعمل force تلقائي. اختَر compatible upstream fix بأدلة رسمية، أو narrowly justified pin/override فقط لو العقد والسياسة يسمحوا ومع اختبارات كاملة. لا audit ignores ولا broad override للتجميل.

`package.json` و`package-lock.json` يتحدثوا عن طريق npm. حافظ على strict exact-version lifecycle approval. أي install-script version جديد محتاج مراجعة واضحة؛ لا dangerously-allow-all-scripts.

اثبت install/typecheck/lint/unit/build/browser ثم Windows package/installed lifecycle بعد dependency changes. سجل أي advisory غير محلول وتأثيره ومساره بدل صفر مزيف.

## 11. أولوية P1: final-main Windows artifact

المثبّت المحلي وقت التدقيق كان من c728f473 بتاريخ 24 أكتوبر، DEVELOPMENT_ARTIFACT وsignature UNAVAILABLE. لا تستخدمه لإثبات النسخة الجديدة.

من main المقبول:

1. نفّذ build ثم verify:desktop.
2. اعمل package:windows من نفس SHA بدون dirt مؤثر.
3. طابق manifest gitSha وactual SHA-256 والحجم مع الـartifact.
4. راقب Authenticode عبر OS ولا تستنتجه من وجود env certificate.
5. DEVELOPMENT/RELEASE_CANDIDATE unsigned لازم يبان صراحة.
6. TRUSTED_RELEASE لا يمر بدون Valid signature ومواد التوقيع الصحيحة.
7. اختبر install على مسار به spaces وper-user، startup/splash/workbench، controlled shutdown.
8. اختبر upgrade/restart/uninstall وعدم فقد user workspace/credentials.
9. راقب loopback ownership والـmain/preload/IPC وإيقاف managed child processes.
10. clean-machine، SmartScreen وpublisher reputation أدلة مستقلة؛ لا تستنتجها من جهاز التطوير.

لو المساحة أو signing material مانعين خطوة، سجل BLOCKED مع حجم/متطلب حقيقي، وكمّل باقي الاختبارات. لا تمسح المثبّت الوحيد أو دليل فريد قبل إثبات البديل واعتماد تنظيفه.

## 12. استكمال كل المجالات الـ9 والـ68 view

استعمل SURFACE-INVENTORY كقائمة فعلية. لكل view سجل: entry route، component، main handler/service، persistence، required permissions، available/unavailable states، tests وfresh evidence.

راجع بالتتابع:

- Projects: open/import/discovery، Recent/Favorites/Pinned/Archive، health freshness ومصدرها؛ Archive لا يمسح المصدر.
- AI: providers/vault/model discovery، disclosure، tasks/agents/session cancellation، diff approval، rollback وusage/cost provenance.
- Online: scoped Explorer، catalogs/details/search/cache/freshness، installed/downloads/updates، explicit network policy.
- Intelligence: graph/dependencies/impact/code-understanding، incomplete scans/cache state وعدم ادعاء semantic coverage غير مقاسة.
- Quality: Sonar/problems/solutions/security/performance/debt/docs/snapshots؛ actual scan/fix/restore وfailure/timeout states.
- Developer Tools: terminal/tests/build/runtime/lint/logs/diagnostics/preview؛ arguments paths Windows، process ownership، stop/restart وعدم الأيتام.
- Remote/Git: local status/branches/commits قبل mutation، GitHub account/PR/issues/checks/releases مع actual permission/rate limit/freshness.
- Release: gate/preparation/artifacts/versioning، source-SHA/build/signing/provenance منفصلة.
- System: settings/trust/permissions/storage/updates/telemetry؛ persistence وحظر denied actions وحقيقة unavailable.

كل button إما handler حقيقي بنتيجة مثبتة أو disabled واضح بسبب متطلب حقيقي. لا بيانات fake، لا fixed hardware metrics، لا empty success toast، ولا automatic network contact يخالف policy.

## 13. DAY/NIGHT وvisual quality

ملاحظات visual جديدة مثبتة: لقطة `verification/preview-workbench-light-mobile.png` أبعادها الفعلية 1440×900، والـmobile مجرد viewport simulation جوه Preview. اللقطة اتاخدت وهي ما زالت Reconciling، وInspector بيعرض Activity = Invalid Date. أصلح parsing/fallback في CanonicalInspector، واثبت settled screenshot قبل اعتمادها. راجع مساحة header/connected services والدّوك المفتوح عشان controls الفعلية ما تختفيش تحت أول viewport. لا تغيّر الهوية أو التصميم من غير سبب وقبول مناسب.

حافظ على cinematic installation/entry والـLiving Mark والأصول والشعار والـmotion المتفق عليهم. تصميم الداخل الحالي مش تصريح لإعادة تصميم مدخل المنتج. نفس structure/behavior في DAY/NIGHT، واختلاف presentation فقط.

صوّر real app عند 1366×768 و1672×941 و1920×1080 لما متاح؛ تحقق من bitmap dimensions، ما تعتمدش على اسم viewport. اعمل captures للـ68 views بالثيمين بعد انتهاء التحميل/الـfade، مع حالات البيانات والـempty/failure المهمة. تجنب screenshot backgrounds أو fake content.

افحص: clipping/overflow، text contrast، focus containment/restore، tab/escape/keyboard، dropdown/dialog layering، reduced motion، long paths/Arabic/English، realistic tables، bounded scroll regions، native unavailable states. اللقطات وحدها لا تثبت handler effect ولا owner acceptance.

الصور المرجعية PENDING_TRANSFER تفضل pending لحد وجود الملف الحقيقي. لا تختلق image reference أو تقول نقلت assets من غير evidence. احتفظ بالـgallery القديمة لحد إثبات ومراجعة البديل.

## 14. المساحة والتنظيف: حقيقة وصلاحيات

المستخدم وافق صراحة على حذف الأربعة دول فقط بعد فحصهم:

- `K:\Knoux Projects\KForge\Base\kforge-security-17qX4N`
- `K:\Knoux Projects\KForge\Base\kforge-security-1jmRHl`
- `K:\Knoux Projects\KForge\Worktrees\KForge-SwcAllowlist-20261027\node_modules`
- `K:\Knoux Projects\KForge\Worktrees\KForge-SwcAllowlist-20261027\dist`

لكن execution review رفض الحذف حتى بعد التأكيد برسالة blocked by policy. لا تعِد سؤال نفس الإذن، ولا تتحايل على السياسة بأداة مختلفة. لو البيئة بتسمح بعد مراجعة النظام، تحقق من absolute path containment/reparse points/content قبل الحذف، ثم سجّل actual absence والـfree space. لو لا، الحالة BLOCKED وتظهر في التسليم.

الـRecovery القديم والصور وauth/config ليست بلا قيمة لمجرد اسم backup. source preservation تم، لكن حذف أصل Recovery كله يتطلب مراجعة بقية ignored unique evidence والـGit objects وmanifest. لا تحذف user credentials/workspace state ولا توسع التنظيف لمشاريع أو أقراص أخرى. تقليل أسماء branches وحده مش توفير مساحة.

ما تسيبش dirt جديد من شغلك: راجع status بعد كل اختبار؛ temporary fixtures تروح OS temp ويتعملها cleanup bounded. أي generated output يتصنف بوضوح، ولا يتحول product source بالغلط.

## 15. التحقق المطلوب

استخدم scripts الحالية:

```text
npm ci
npm run test:github-connect
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit
npm run verify:gate
npm run verify:desktop
npm run package:windows
npm run verify:installer
```

`verify:release` لو البيئة تسمح بالمسار كله. لا تعيد نفس suite الناجحة بلا سبب؛ أعدها عند تغيير كود/اعتماد/فشل له صلة. اختبارات الاستيراد والدومينات والأجهزة لها dependencies حقيقية، لازم حدود الدليل تبان. أعد focused regression بعد كل إصلاح ثم authoritative gate وexact final main CI.

أي timeout افصله عن assertion failure وmissing tool وprovider failure. اعرض command وexit وtested SHA وplatform ووقت التنفيذ. Self Audit بيشغل جزء من الاختبارات داخل المنتج؛ نجاح Vitest لوحده لا يثبت Self Audit user journey.

## 16. طريقة تنفيذ مستقلة وآمنة

اشتغل في شرائح مكتملة: trace -> implement -> focused test -> review diff -> actual runtime -> commit ضمن التفويض -> integrate requested workflow -> verify final main. لا تعمل مئات ملفات WIP ولا worktree جديد بلا داعي.

لو الإصلاح اتعارض مع visual أو native behavior، حل التعارض في نفس slice؛ ما تعتبرش compile كفاية. لو credentials أو signing أو owner OAuth محتاجين تدخل، اطلب المعلومة المحددة بعد تجهيز كل الشغل المستقل والنتيجة القابلة للمراجعة. متوقفش باقي العمل المسموح بسبب blocker واحد.

استعمل research التاريخي كمدخل فقط. الأدلة الحالية والـofficial docs للـSDK/provider هي المرجع، مع الحفاظ على architecture الحالية. لا deep dependency override أو خدمة مدفوعة أو backend موازي بلا سبب ملموس وتفويض مناسب.

## 17. شروط إغلاق المهمة

لا تقول COMPLETE/RELEASED/100% إلا لما المتطلبات نفسها متحققة. سلم جدول Gates A–G: scope، preservation، implementation، quality، runtime، integration، evidence. كل بند عليه VERIFIED/PARTIALLY VERIFIED/IMPLEMENTED BUT UNVERIFIED/BLOCKED/NOT IMPLEMENTED حسب الحقيقة.

التقرير النهائي يفصل:

- modified locally / tested locally.
- committed / pushed / PR state / merged main.
- CI on exact final main.
- packaged / installed / signing observed.
- deployed backend / production health / real OAuth/provider effects.
- cleanup actually executed / retained unique evidence / free space measured.

اربط الملفات والـSHAs والـCI/PR/deployment URLs الحقيقية. اذكر ما لم يُختبر وسبب عدم الاختبار، والنواقص المتبقية والخطوة الآمنة المحددة. ما تكتبش نجاح من تقرير قديم أو test count محفوظ. المهمة هدفها منتج حقيقي موثوق، بصريًا ووظيفيًا وأمنيًا، بدون فقد شغل فريد وبدون fake closure.
