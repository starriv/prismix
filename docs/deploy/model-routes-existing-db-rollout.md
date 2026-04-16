# 生产已有数据部署步骤

适用场景：**生产库已有数据**

## 本次发布不要做的事

- 不要先执行 `pnpm db:migrate`
- 不要修改 `drizzle/0002_purple_black_tarantula.sql`

## 部署步骤

1. 停应用，或至少停掉 AI models / providers 的后台写入。

2. 备份数据库。

3. 执行手工迁移脚本：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/0020-model-routes-migration.sql
```

4. 执行校验 SQL：

```sql
SELECT COUNT(*) AS duplicate_model_ids
FROM (
  SELECT model_id
  FROM ai_models
  GROUP BY model_id
  HAVING COUNT(*) > 1
) dupes;

SELECT COUNT(*) AS missing_routes
FROM ai_models m
WHERE m.provider_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_model_routes r
    WHERE r.model_id = m.id
      AND r.provider_id = m.provider_id
  );
```

5. 确认结果：

- `duplicate_model_ids = 0`
- `missing_routes = 0`

6. 发布代码并重启应用。

## 回滚

- 用部署前备份恢复
