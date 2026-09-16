-- 009_permanent_workspace_isolation.sql
-- Bảo vệ vĩnh viễn tính cô lập dữ liệu giữa các tổ chức/tài khoản và ngăn chặn hoàn toàn dữ liệu demo

CREATE OR REPLACE FUNCTION public.dochub_sync_authorization_snapshot(
  p_organization_id UUID,
  p_folders JSONB,
  p_users JSONB,
  p_groups JSONB,
  p_acl JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
  v_demo_uids TEXT[] := ARRAY[
    'board','board-docs','executive','business','business-plan','customers',
    'admin','salary','salary-forms','allowance','discipline','administration',
    'finance','sales-policy','finance-reports','hr','recruitment','training',
    'employee-records','processes','production','admin-processes','archive','supplier-contracts'
  ];
BEGIN
  v_role := public.dochub_org_role(p_organization_id, auth.uid());
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_folders) <> 'array' OR jsonb_typeof(p_users) <> 'array'
     OR jsonb_typeof(p_groups) <> 'array' OR jsonb_typeof(p_acl) <> 'array' THEN
    RAISE EXCEPTION 'invalid_authorization_snapshot' USING ERRCODE = '22023';
  END IF;

  -- 1.1 Cập nhật thành viên, chặn triệt để các email mẫu demo (@example.com)
  INSERT INTO public.organization_members(
    organization_id, user_id, app_user_uid, email, display_name, department,
    organization_role, status, updated_at
  )
  SELECT p_organization_id,
    CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END,
    u->>'id', lower(u->>'email'), u->>'name', COALESCE(u->>'department', ''),
    CASE WHEN u->>'id' = 'u1' THEN 'owner' ELSE 'member' END,
    CASE WHEN COALESCE((u->>'active')::BOOLEAN, TRUE) THEN
      CASE WHEN (CASE WHEN u->>'id' = 'u1' THEN auth.uid() ELSE existing.user_id END) IS NULL THEN 'invited' ELSE 'active' END
    ELSE 'suspended' END,
    NOW()
  FROM jsonb_array_elements(p_users) u
  LEFT JOIN public.organization_members existing
    ON existing.organization_id = p_organization_id AND lower(existing.email) = lower(u->>'email')
  WHERE u->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    AND COALESCE(u->>'email', '') <> ''
    AND lower(u->>'email') NOT LIKE '%@example.com'
    AND lower(u->>'email') NOT LIKE '%@test.com'
  ON CONFLICT (organization_id, app_user_uid) DO UPDATE SET
    email = EXCLUDED.email, display_name = EXCLUDED.display_name,
    department = EXCLUDED.department, status = EXCLUDED.status,
    user_id = COALESCE(public.organization_members.user_id, EXCLUDED.user_id), updated_at = NOW();

  -- 1.2 Cập nhật nhóm làm việc
  INSERT INTO public.organization_groups(organization_id, app_group_uid, name, description, updated_at)
  SELECT p_organization_id, g->>'id', g->>'name', COALESCE(g->>'description', ''), NOW()
  FROM jsonb_array_elements(p_groups) g
  WHERE g->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
  ON CONFLICT (organization_id, app_group_uid) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW();

  -- 1.3 Cập nhật thư mục, CHẶN TRIỆT ĐỂ toàn bộ 24 thư mục demo
  INSERT INTO public.organization_folders(
    organization_id, folder_uid, parent_uid, name, description,
    inherit_permissions, deleted_at, created_by, updated_at
  )
  SELECT p_organization_id, f->>'id', NULLIF(f->>'parentId', ''), f->>'name',
    COALESCE(f->>'description', ''), COALESCE((f->>'inherit')::BOOLEAN, (f->>'parentId') IS NOT NULL),
    NULLIF(f->>'deletedAt', '')::TIMESTAMPTZ, auth.uid(), NOW()
  FROM jsonb_array_elements(p_folders) f
  WHERE f->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    AND NOT (f->>'id' = ANY(v_demo_uids))
  ON CONFLICT (organization_id, folder_uid) DO UPDATE SET
    parent_uid = EXCLUDED.parent_uid, name = EXCLUDED.name, description = EXCLUDED.description,
    inherit_permissions = EXCLUDED.inherit_permissions, deleted_at = EXCLUDED.deleted_at, updated_at = NOW();

  -- 1.4 Cập nhật phân quyền ACL, CHẶN TRIỆT ĐỂ thư mục demo
  INSERT INTO public.folder_acl_entries(
    organization_id, folder_uid, member_id, group_id, role, updated_at
  )
  SELECT DISTINCT ON (p_organization_id, a->>'resourceId', m.id, g.id)
    p_organization_id, a->>'resourceId', m.id, g.id, a->>'role', NOW()
  FROM jsonb_array_elements(p_acl) a
  LEFT JOIN public.organization_members m
    ON m.organization_id = p_organization_id AND (m.app_user_uid = a->>'principalId' OR m.user_id::TEXT = a->>'principalId')
  LEFT JOIN public.organization_groups g
    ON g.organization_id = p_organization_id AND g.app_group_uid = a->>'principalId'
  WHERE a->>'resourceId' ~ '^[A-Za-z0-9_-]{1,100}$'
    AND a->>'role' IN ('viewer', 'contributor', 'editor', 'manager', 'owner')
    AND NOT (a->>'resourceId' = ANY(v_demo_uids))
    AND ((a->>'principalType' = 'user' AND m.id IS NOT NULL) OR (a->>'principalType' = 'group' AND g.id IS NOT NULL))
  ON CONFLICT (organization_id, folder_uid, member_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW();
END;
$$;
