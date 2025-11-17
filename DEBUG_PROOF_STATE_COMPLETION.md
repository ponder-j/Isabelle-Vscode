# 调试 Proof State 自动补全功能

## 问题描述
在 `case (Suc n)` 后面按回车没有自动补全反应。

## 调试步骤

### 1. 查看插件的调试输出

1. **打开 VS Code 的开发者工具**：
   - 按 `Cmd+Shift+P`（macOS）打开命令面板
   - 输入 "Developer: Toggle Developer Tools"
   - 选择该命令打开开发者工具

2. **切换到 Console 标签页**

3. **在 Console 中筛选日志**：
   - 在控制台的过滤框中输入 `[ProofState]` 查看状态相关日志
   - 或输入 `[ProofStateCompletion]` 查看补全相关日志

### 2. 重新编译和加载插件

```bash
cd /Users/ponder/Codes/Isabelle-Vscode
npm run compile
```

然后在 VS Code 中：
- 按 `Cmd+Shift+P`
- 输入 "Developer: Reload Window"
- 选择该命令重新加载窗口

### 3. 测试自动补全

1. 打开你的 Isabelle 文件
2. 将光标放在 `case (Suc n)` 行的末尾
3. 按回车键
4. 观察控制台的日志输出

### 4. 关键日志点

查看以下日志来判断问题出在哪里：

#### A. LSP 是否发送了 state_output？
```
[ProofState] Received state_output_type notification
[ProofState] Content length: XXX
```
- **如果没有这条日志**：说明 LSP 服务器没有发送状态输出
  - 可能的原因：光标位置不在证明上下文中
  - 解决方法：确保 Isabelle 服务器已经处理了该行

#### B. 当前行是否被正确识别？
```
[ProofState] Current line: case (Suc n)
[ProofState] Trimmed line: case (Suc n)
[ProofState] Line matches proof/case: true
```
- **如果 "Line matches" 为 false**：说明正则表达式没有匹配到
  - 检查光标是否在 `case (Suc n)` 这一行
  - 问题：当你按回车后，光标已经移动到下一行了！

#### C. 是否提取到了 goal？
```
[ProofState] Extracting goal from content...
[ProofState] Full content: [完整的 LSP 输出]
[ProofState] Goal match found: true
[ProofState] Extracted goal: [提取的 goal 内容]
[ProofState] Goal cached successfully
```
- **如果 "Goal match found" 为 false**：说明正则表达式没有匹配到 goal
  - 检查 LSP 输出的格式是否符合预期

#### D. 补全是否被触发？
```
[ProofStateCompletion] provideCompletionItems called
[ProofStateCompletion] Has cached goal: true
[ProofStateCompletion] Previous line: case (Suc n)
[ProofStateCompletion] Previous line matches proof/case: true
```

#### E. 是否成功解析了 goal？
```
[ProofStateCompletion] Parsing goal: [goal内容]
[ProofStateCompletion] Parsed result: {variables: [...], assumptions: [...]}
```

### 5. 可能的问题和解决方案

#### 问题 1: 时序问题
**症状**：按回车后光标已经移到下一行，但此时 LSP 还没有发送新的状态输出

**解决方案**：需要在按下回车键时检查**下一行**的状态，而不是当前行。或者延迟检查。

#### 问题 2: LSP 输出格式不匹配
**症状**：日志显示收到了内容，但没有提取到 goal

**解决方案**：
1. 查看 `[ProofState] Full content:` 的完整输出
2. 对比实际格式与正则表达式 `/goal\s*\([^)]*\):\s*([\s\S]*?)(?=\n\n|$)/`
3. 调整正则表达式以匹配实际格式

#### 问题 3: 补全提供器未被调用
**症状**：没有看到 `[ProofStateCompletion] provideCompletionItems called` 日志

**解决方案**：
- 检查补全提供器是否正确注册
- 尝试手动触发补全（Ctrl+Space）
- 检查是否有其他补全提供器阻止了该补全

### 6. 手动测试补全

在新行尝试手动触发补全：
1. 在 `case (Suc n)` 后按回车
2. 在新的空行上按 `Ctrl+Space`
3. 查看是否出现 "fix/assume (from goal)" 补全项

## 预期的工作流程

正确的工作流程应该是：

1. 用户输入 `case (Suc n)` 并停留在该行
2. LSP 服务器处理该行，发送包含 goal 的状态输出
3. 插件接收到状态输出，检查当前行是否以 `proof/case` 开头
4. 如果是，提取并缓存 goal
5. 用户按回车，光标移到下一行
6. 补全提供器被触发
7. 检查上一行是否包含 `proof/case`
8. 如果有缓存的 goal，生成并提供补全

## 可能需要的改进

从你的描述来看，主要问题可能是：

**时序问题**：当你在 `case (Suc n)` 后按回车时，光标已经移动到下一行，但此时检查的"当前行"已经不是 `case (Suc n)` 了。

建议的修复方案：
- 方案 A：在接收 LSP 状态输出时，不检查当前行，而是**总是**缓存 goal
- 方案 B：在补全时检查上一行，而不是在接收状态时检查当前行
- 方案 C：使用更智能的上下文感知机制

我会在下一步实现改进方案。
