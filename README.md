# VEGAS Media Library

VEGAS 的共享素材与运行时模块唯一来源。

## 目录
- `Backgrounds/`：页面背景。
- `Brand/`：VEGAS 品牌标识与应用图标。
- `Logos/`：27 个品种 SVG 标识。
- `Cards/`：行情卡片视觉模板。
- `Charts/`：Vegas EMA 绘制模块、配色与K线视觉规范。
- `modules/logo/`：Logo 展示模块。
- `modules/rolling-cards/`：滚动卡片模块。
- `modules/shared/`：Bitget 客户端、生命周期、品种池与行情缓存基础模块。
- `modules/signal-ticker/`：V12 信号读取与底部滚动展示模块。
- `kline/`：V5当前K线视图/手势、固定视窗状态与配套EMA模块。
- `References/`、`Templates/`、`UI/`：技术规范与展示参考。

## 使用边界
- V5 自有的页面编排、K线控制器和K线Canvas保留在 V5 仓库。
- 多页面共用的运行时模块只在本仓库维护一份；页面通过版本化 URL 引用，不保留重复副本。
- 本仓库不承载交易信号生成、密钥或运行状态。
- 修改共享模块后，应同步核对所有消费者的引用与缓存版本。
