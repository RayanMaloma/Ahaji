-- Phase 3 seed from the approved local room configuration and hint files.
-- Re-running it only inserts missing positions; it does not overwrite edits.
-- Apply after the foundation migration; credentials stay outside this file.

insert into public.rooms (id, name, thumbnail_ref, background_ref, default_duration_seconds, display_order)
values ('anbar', 'عنبر 23', 'images/prison.jpg', 'source/prison/background.jpg', 3600, 0)
on conflict (id) do nothing;

insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'القفل الرصاصي وش يحتاج؟', 0)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الأشكال ممكن تكون اتجاهات', 1)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الأسهم بتساعدكم في فتح القفل الرصاصي', 2)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الأشكال بالمراة تبدو مختلفة عن الواقع', 3)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'القفل الرصاصي يحتاج إلى أسهم ولكن تذكروا ان الأشكال في المرأة تبدو مختلفة عن الواقع', 4)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'فوق - تحت - يمين - يسار - فوق - يمين - تحت', 5)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'فتحة التصريف بالزنزانة رقم 2', 6)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'فيه أماكن غير متوقعة داخل الزنزانة أخفى فيها السجين السابق أدوات ممكن تحتاجونها', 7)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'بعض المساجين يخفون أغراضهم المهمة بالجدار', 8)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'السلك المغناطيسي يدخل بالفتحة التي بجانب الصندوق المخفي بالجدار', 9)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'السلك المغناطيسي له جهتين تأكدوا من استخدام الجهة الموجود فيها المغناطيس واسحبو ببطأ', 10)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'مؤلمة تلك الليالي', 11)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'وضع نبيل الرقم السري للهاتف بعد ما قرأ مذكرته ، وترك تلميح (مؤلمة تلك الليالي)', 12)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'قرأت مذكرتك ياهيثم كثيره تلك الليالي المؤلمة', 13)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'رقم الجوال مكون من 6 أرقام', 14)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'في الليلة الاخيرة....', 15)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', '3 5 ? 2 9 4', 16)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'جميع الأرقام اللي طلعتوها صحيحة ماعدا رقم 4 9 2 ? 5 3', 17)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'استكشفوا الدواليب', 18)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الخريطة فيها عوالم وأسرار', 19)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'استعملوا الفلاش في التطبيق', 20)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'فيه اكثر من من باركود (استخدموا فلاش الجوال)', 21)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'اللي في الزنزانة الثانية تتوقعون تطلعون مع الباب ؟', 22)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'فيه مفك على شكل حرف L راح يساعدكم', 23)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'التقويم فيه رسالة', 24)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'أسرع ياسجناء', 25)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'قفلوا الجرس لا يسمعونكم الحراس', 26)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'تذكروا رساله نبيل', 27)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'اتصلوا على نبيل', 28)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'Fake Phone اتصلوا على نبيل من تطبيق', 29)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'أرقام حراس السجن موجودة في مكتب مدير السجن', 30)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'وين ممكن تكون مفاتيح الزنزانة بأمان؟', 31)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'اضغطوا Lock بعد ما تدخلون الرقم بالخزنة', 32)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الرف الصغير أسفل شاشة الكمبيوتر اكيد فيه شيء', 33)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'دخلوا أياديكم داخل الرف تحسسوا الموجود', 34)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'ما لاحظتوا الزر الأحمر؟', 35)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'ألوان خلفية شاشة الكمبيوتر تدلكم على استخدام الزر الاحمر', 36)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'الوان خلفية شاشة الكمبيوتر بتدلكم على بعض القطع', 37)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'باستخدام القيش الاحمر ابحثوا عن الأرقام على القطع اللي تحمل نفس الوان خلفية الكمبيوتر', 38)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'حامل الورق-الكرسي-القبعة-العلم', 39)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'رمز الكمبيوتر مكون من 8 أرقام.. على كل لون بتحصلون رقمين', 40)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'عليكم معرفة دور كل شخص بالجريمة (القاتل، القائد، الهاكر) دون تحريك الصور', 41)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'قاتل-قائد-هاكر... ويرمز للقاتل بالمسدس', 42)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'ياسر هو القاتل', 43)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'أسرع ياسجناء استراحه الحراس شارفت على الانتهاء', 44)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', '!Hurry-up prisoners', 45)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', '!Objects in the mirror may appear different than they are', 46)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'Check out the cabinet', 47)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'Do not forget Nabeel''s letter', 48)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('anbar', 'count the nights in the dairy to figure out the mobile passcode', 49)
on conflict (room_id, display_order) do nothing;

insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('anbar', 'hint_sound', null, 'source/prison/hint-sound.mp3', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('anbar', 'lose_sound', null, 'source/prison/loose-sound.mp3', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('anbar', 'gm_image', 'مكان فك الزنزانة', 'source/prison/images/مكان فك الزنزانة.png', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('anbar', 'gm_sound', 'صوت باب العنبر', 'source/prison/sounds/صوت باب العنبر.mp3', 0)
on conflict (room_id, kind, display_order) do nothing;

insert into public.rooms (id, name, thumbnail_ref, background_ref, default_duration_seconds, display_order)
values ('haram', 'الهرم', 'images/pyramid.png', 'source/pyramid/background.jpg', 3600, 1)
on conflict (id) do nothing;

insert into public.room_hints (room_id, body, display_order)
values ('haram', 'oxygen percentage : 100%', 0)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'العين لازم تقابل العين', 1)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تحتاجون اقل شي اربع مكعبات بيضاء على صف واحد والمكان الخامس فاضي', 2)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تحتاجون على الاقل اربع مكعبات بيضاء تكون في النص بخط واحد بحيث ان العين تقابل العين بدون عوائق', 3)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'الدرج يتكون من اربع قطع: الرأس - يد - جسم - أرجل', 4)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تأكدوا من ثبات درج الصعود في الطلوع والنزول', 5)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'الجزء الوسط من الجسم يركب بشكل مسطح', 6)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'هدفكم في درج الصعود الرمز يكون كامل + الدرج يكون ثابت لسلامتكم', 7)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'رمز الدرج تقريبا اكتمل ماعرفتوه؟', 8)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'طاولة القطة اكيد فيها سر', 9)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'غطاء أحمر', 10)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'اعطوا كل شكل قيمة حسب وزنه في المعادلة', 11)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'اعطوا كل شكل قيمة حسب وزنه في المعادلة .. أثقلهم وزن المثلث =4', 12)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'عندكم باللوحة أربع موازين.. كل ميزان فيها متساوي الكفتين.. حاولوا تعرفون قيمة الاستفهام اللي تعادل الكفة اليسار في الميزان الآخر', 13)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'اعطوا كل شكل قيمة حسب وزنه في المعادلة .. أثقلهم وزن المثلث =4 واخفهم وزن المتوازي = 1', 14)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تحتاجون 4 عصيان مجموعهم=8', 15)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'المثلث= 4 المربع= 3 الدائرة= 2 متوازي الأضلاع= 1', 16)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'العصيان اللي بتستخدم: عصاتين دائرة + عصا متوازي أضلاع + عصا مربع', 17)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'oxygen percentage : 50%', 18)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'طاولة الخنفسانه أكيد فيها سر', 19)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'الخنفسانه بتساعدكم في فتح الطاوله السوداء', 20)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'اسحبوا الغطاء الأسود بالكامل', 21)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'جربوا تسحبون جانبي الطاولة', 22)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'داخل الطاولة فيه 8 رموز رمز واحد فقط يطابق أحد الرموز بجانب الباب', 23)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'طابقوا الرموز الي اكتشفتوها في الغرفة بالرموز الموجودة بجانب الباب', 24)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تحتاجون اربع رموز صحيحة بجانب الباب', 25)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'الوحش جوعان', 26)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'الرف الأحمر بيتحرك عشان تدخلون بسهوله', 27)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'النفق له مدخل .. وله مخرج', 28)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'oxygen percentage : 25%', 29)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تحتاجون 4 رموز ورقية و العصا الخشبيه لفتح الباب الاخير', 30)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('haram', 'تذكروا ان ضغطكم للرموز بشكل عشوائي راح يصعب المهمه عليكم ويخصم من وقتكم', 31)
on conflict (room_id, display_order) do nothing;

insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('haram', 'hint_sound', null, 'source/pyramid/hint-sound.mp3', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('haram', 'gm_image', 'تلميح لغز العصا', 'source/pyramid/imghint1.png', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('haram', 'gm_image', 'تلميح لغز الدرج', 'source/pyramid/imghint2.png', 1)
on conflict (room_id, kind, display_order) do nothing;

insert into public.rooms (id, name, thumbnail_ref, background_ref, default_duration_seconds, display_order)
values ('saleh', 'العم صالح', 'images/unclesaleh.png', 'source/unclesaleh/background.jpg', 3600, 2)
on conflict (id) do nothing;

insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'تحت القماش الأسود تلقى ضالتك', 0)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'ما لاحظتوا شيء بالمتاهة؟', 1)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'المفتاح حديد، تحتاجون...؟', 2)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'المكعب حديد، تحتاجون...؟', 3)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'العم صالح كان يستخدم النجر بغير الطحن', 4)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'التركيبة 20 قطعة تأكدوا انكم حصلتوها كلها', 5)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'ما ودكم تلعبون كيرم؟', 6)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'حبوب الكيرم بتساعدكم بحل معادلة الأشكال الهندسية', 7)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'لكل لون من حبوب الكيرم شكل معين بالمعادلة وقيمة معينة', 8)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'من قوانين الرياضيات الأساسية أن الضرب يسبق الجمع', 9)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'المثلث= 50 الدائرة= 10 المربع= 5', 10)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', '(50x10)+(5x5)+50=???', 11)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'وين ممكن تستخدمون الرمز المكون من ثلاث أرقام؟', 12)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'العم صالح كان يحب يتابع التلفزيون', 13)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'استخدام المفتاح قريب جداً من مكتب العم صالح', 14)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'عندكم 4 احتمالات للكود إذا اتبعتوا الأسهم في التركيبة', 15)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'عندكم 4 احتمالات للروائح إذا اتبعتوا الأسهم في التركيبة', 16)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'من الأسفل للأعلى ( هيل - زنجبيل - ليمون قهوه )', 17)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'العم صالح كان يحب الهيل', 18)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'هيل نعناع زنجبيل قهوة', 19)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'كل مثل يدل على كلمة واحدة', 20)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'كل مثل له معنى كلمة واحدة .. وكل كلمة تدل على شي موجود في الغرفة', 21)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'وش يعني طويلة ساق ان حركتها قالت طاخ ؟', 22)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'طاخ طاخ طاخ = موت', 23)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'وش هي اللي تاكل الأخضر واليابس ؟', 24)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'وش هو اللي له قرنين وأربع رجلين ؟', 25)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'كيف ممكن تستنتجون رقم من كل صورة ؟', 26)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'عدد البنادق | عدد النار | عدد الخرفان = كود يفتح لكم القفل', 27)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'عدد البنادق | عدد النار | عدد الخرفان = رقم تتصلون عليه', 28)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'حافظوا على ترتيب المفاتيح** (تحتاجون رقم و لون لكل قفل) استخدام المفاتيح بشكل عشوائي راح يصعب المهمة**', 29)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'كل ورقة فيها عبارة وصورة .. العبارة تدلكم على رقم والصورة تدلكم على لون لوحة المفاتيح', 30)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'كم عدد حروف الهجاء؟', 31)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'المراية بتساعدكم في معرفة عدد حروف الهجاء', 32)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'الورقة البيضاء بتساعدكم في معرفة العدد', 33)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'ألف ليلة + ليلة = ؟؟؟؟', 34)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', '1000 + 1', 35)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'الأكيد ان الرقم مب 26 ركزوا بالعبارة زين', 36)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'في مصر يقولون تفضلي يا ست', 37)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'يعرف العم صالح عشرين رجال وست واحدة', 38)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'سبحة العم صالح وين ممكن تكون؟', 39)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'سبحة العم صالح موجودة بالغرفة الأولى', 40)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'عمر العم صالح موجود في الغرفة الأولى', 41)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'الصور غالباً فيها ذكريات وتواريخ', 42)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'تاريخ الوفاة - تاريخ الميلاد', 43)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'نصف الـ 120 = ؟؟ ، ثلث الـ 60 = ؟؟ ، ربع الـ 20 = ؟ ، خمس الـ 5 = ؟', 44)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'نصف الـ 120 = 60 ، ثلث الـ 60 = 20 ، ربع الـ 20 = 5 ، خمس الـ 5 = 1', 45)
on conflict (room_id, display_order) do nothing;
insert into public.room_hints (room_id, body, display_order)
values ('saleh', 'يد وحدة ما تصفق', 46)
on conflict (room_id, display_order) do nothing;

insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('saleh', 'hint_sound', null, 'source/unclesaleh/hint-sound.mp3', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('saleh', 'lose_video', null, 'source/unclesaleh/loose-video.mp4', 0)
on conflict (room_id, kind, display_order) do nothing;
insert into public.room_media (room_id, kind, label, asset_ref, display_order)
values ('saleh', 'gm_image', 'تلميح لغز التركيبة', 'source/unclesaleh/imghint1.png', 0)
on conflict (room_id, kind, display_order) do nothing;
