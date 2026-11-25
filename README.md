# remotion-production

本地编辑 Remotion，GitHub Actions 并行渲染同一条视频，最后在云端无视频重编码地合成 H.264/AAC MP4。

> 这是一个公开仓库模板：只提交你有权公开的代码、字体和媒体。不要把 PAT、API key、客户素材或私有音频放进仓库或 workflow 输入。

## 并发模型

GitHub Free 标准托管 runner 的总并发上限是 20。本项目的生产渲染按**硬上限 16 个渲染 job**设计：

- 最多 15 个视频分片 job（矩阵 `max-parallel: 15`）；
- 1 个完整时间轴音频 job（PCM WAV）；
- `prepare` 和 `assemble` 不属于渲染 job，且生产 workflow 使用固定的 `concurrency.group: remotion-production-render`。

固定 workflow 级并发组是必要的：GitHub Actions 没有跨 workflow run 的 16 槽 semaphore。固定组会让整个生产批次串行，牺牲跨批次吞吐来保证同一仓库不会让多个批次叠加。`queue: max` 让等待批次排队，而不是默认替换旧的 pending 批次；它不是 16 槽配置，最多允许 100 个等待批次。其它仓库或 workflow 仍会竞争账户级 20 槽，不能保证 GitHub 立即调度。

参考：

- [GitHub Actions job concurrency limits](https://docs.github.com/en/actions/reference/limits#job-concurrency-limits-for-github-hosted-runners)
- [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Remotion rendering](https://www.remotion.dev/docs/renderer/render-media)

## 本地开发

```bash
npm ci
npm run typecheck
npm test
npm run studio
```

`Demo` 是 640×360、30 fps、90 帧的快速验收片；`Silent` 没有音轨，用于检查等长静音音轨；`Benchmark` 是 1920×1080、30 fps、900 帧的性能对照。每条 Composition 都在源码中注册，新增视频只需在 `src/Root.tsx` 添加组件和 `<Composition>`。

本项目锁定 Remotion `4.0.536`，渲染脚本同时锁定 bundler 和 renderer 版本。Remotion 的许可证可能要求部分公司购买 Company License；请按自身主体和用法核对 [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)。

## 工作流

1. Actions → **Render video** → 输入 Composition ID（默认 `Demo`）和视频分片数 `1–15`。
2. `prepare` 只构建一次 bundle，用 `selectComposition` 读取真实帧数、fps 和尺寸，再写带提交 SHA、run ID、分片边界的 manifest。
3. 视频 job 使用绝对帧区间渲染无声 H.264；音频 job 完整渲染为 48 kHz PCM WAV，不按分片编码 AAC，避免音频接缝。
4. `assemble` 通过 `ffprobe` 验证每片：单视频流、H.264、yuv420p、分辨率、CFR、首帧关键帧、帧数、90 kHz 时间基和连续展示时间戳。再用 concat demuxer 拼视频（`-c:v copy`），只把 WAV 编码一次为 AAC，验证成品后再上传。

所有输入先经环境变量送入 Node 校验；不接受任意 shell 参数、URL、路径或 FFmpeg flags。产物名包含 run ID、run attempt 和分片 ID。合成按分片选取同一 run 中最新的产物，核对清单摘要；局部重跑可以复用仍在保留期内的成功分片，过期后需重新触发整条工作流。拒绝缺片、重复片、越界片和额外文件。

短片先试 `shards=1`，长片可从 `4` 开始。同一提交以相同 Composition 各跑一次，比较 Actions 页面从提交运行到完成的时间（含排队）和产物报告中各阶段耗时。更多分片不一定更快：runner 启动、浏览器下载、产物传输和最终解码检查都是固定开销。

## 公开素材与本地限制

不要依赖外部媒体 URL；在仓库中只放已经取得公开授权的素材，并在 README 或素材目录记录来源和许可证。工作流使用标准 Ubuntu runner；本地 ARM64 容器即使能下载 Remotion Headless Shell，也可能缺少浏览器系统库，因此本地无法渲染不代表 GitHub Actions 无法渲染。项目的本地 typecheck 和单测不依赖浏览器或 FFmpeg。

## 诊断

- `npm run typecheck && npm test` 是本地最低检查；`node tests/workflow-policy.mjs` 检查并发策略，`node tests/media-integration.mjs` 用 FFmpeg/ffprobe 验证无重编码拼接、分片顺序和整轨音频。
- `npm run preview` 需要可运行的 Chrome Headless Shell；`ffmpeg`/`ffprobe` 由 GitHub runner 提供。
- 生产 workflow 的所有官方 Actions 固定到完整 commit SHA；仓库权限为 `contents: read`，checkout 不保留凭据，PR 只运行 CI，不自动生产渲染。
- 中间产物保留 1 天，最终 MP4 和报告保留 14 天。
