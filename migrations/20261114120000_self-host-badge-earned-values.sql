-- 挣到值（成就并集的锦上添花, 站主 2026-11-14 拍板, KI-084）。
--
-- tokentracker_account_badges 只存了各档解锁时间戳；客户端弹窗里「另一台
-- 设备挣到钻石那天实际跑到多少」无从展示。新列 earned_values 持各档挣到值
--（{"bronze": number|null, "silver": ..., "gold": ..., "diamond": ...}），
-- 由 tokentracker-badge-sync 与 achieved 同一条读-合并-写路径维护：每档的
-- 值属于该档时间戳的胜者设备，胜者没带值就留 null（未知≠别人的读数）。
-- 旧客户端不传 values：normalize 后全 null，不会擦掉已有值（平局/缺失时
-- 保留已存值）。该列无 RLS 变化——表本身只对 service role 开放。

ALTER TABLE public.tokentracker_account_badges
  ADD COLUMN IF NOT EXISTS earned_values jsonb;
