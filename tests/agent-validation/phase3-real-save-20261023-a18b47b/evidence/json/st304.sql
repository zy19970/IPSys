SELECT f.workspace AS ws, f.id AS file_id, f.name AS name,
       v.version AS ver, v.object_id AS object_id,
       o.workspace AS object_ws, o.state AS state, o.size AS size,
       substr(o.sha256,1,16) AS sha16,
       (SELECT COUNT(*) FROM file_chunks c WHERE c.object_id=o.id AND c.workspace=o.workspace) AS chunks,
       (SELECT COALESCE(SUM(length(c.bytes)),0) FROM file_chunks c WHERE c.object_id=o.id AND c.workspace=o.workspace) AS chunk_bytes
FROM files f
JOIN file_versions v ON v.file_id=f.id AND v.workspace=f.workspace
JOIN file_objects o ON o.id=v.object_id AND o.workspace=v.workspace
WHERE f.name LIKE 'p3-iso%' AND v.deleted=0
ORDER BY f.workspace, f.id, v.version
