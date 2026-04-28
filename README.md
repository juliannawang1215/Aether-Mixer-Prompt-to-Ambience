# Aether Mixer v4.5 — Aether Synthesis Edition

基于生成式 AI 的沉浸式环境发生器。用一句描述构筑包含视觉与程序化音频的虚拟空间。

## 功能

- **唤醒时空**：全屏初始化，解决浏览器自动播放限制
- **语义解析**：Gemini 2.5 Flash 将 Prompt 转为绘图提示词、混音配置、标题与标签
- **程序化声学**：Web Audio 实时合成 9 轨（雨/火/风/浪/鸟鸣/雷/咖啡馆/火车/白噪音），粉红噪基底、LFO、滤波；未生成场景前静音
- **智能调音台**：仅展示权重 >0 的轨道，滑块实时调节增益（<50ms）
- **Surprise Me**：预设意境词，点击填入输入框，需用户确认后再生成
- **律动视觉化**：底部波纹与播放状态同步

## 开发

```bash
cd aether-mixer
cp env.example .env
# 编辑 .env，填入 VITE_GEMINI_API_KEY（Gemini 用于解析意境与混音配置）
npm install
npm run dev
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_GEMINI_API_KEY` | 必填。Gemini API Key，用于语义解析与混音配置 |

图像生成：当前为占位渐变。可后续接入 Imagen 4.0（Vertex AI）或其它服务。

## 技术

- Vite + React 19
- Framer Motion（>1000ms 转场）
- Web Audio API（程序化合成，零跨域依赖）
- 深色+毛玻璃、极细字体
