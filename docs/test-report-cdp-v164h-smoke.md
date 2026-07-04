# V16.4-H CDP smoke 报告

- **测试时间**: 2026-07-04T17:28:14.095Z
- **CDP 端口**: 9223
- **通过**: 14
- **失败**: 0
- **跳过**: 0

## 详细结果

| 状态 | 测试项 | 详情 |
|------|--------|------|
| ✅ | A1 approval card 出现 | card=true |
| ✅ | A2 composerBar is-approval-active | - |
| ✅ | A3 无旧横条 perm-card | - |
| ✅ | A4 4 按钮文案正确 | Yes, proceed | Yes, don't ask again for this session | No, skip this once | No, don't ask again this session |
| ✅ | A5 Yes, proceed 后 pending 消失 | pending=0 |
| ✅ | A6 No, skip this once 后 pending 消失 | pending=0 |
| ✅ | B1 clarification card 出现 | - |
| ✅ | B2 无 approval card | - |
| ✅ | B3 composerBar is-user-input-active | - |
| ✅ | B4 Submit 后 pending 消失 | - |
| ✅ | C1 Running 含 run-glow | - |
| ✅ | C2 Needs approval/input 无 run-glow | - |
| ✅ | C3 Thinking 合并 span 结构正确 | statusText=1 summary=1 merged=1 |
| ✅ | C4 普通用户态无 raw JSON / [object Object] | - |

*报告由 scripts/cdp-v164h-smoke.mjs 自动生成*