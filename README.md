# Isabelle/VSCode Prover IDE

An enhanced VSCode extension for Isabelle theorem prover with intelligent auto-completion and productivity features.

[中文说明](#中文说明) | [English](#english)

---

## English

### Features

#### 1. Function Definition Auto-Completion

Intelligent auto-completion for Isabelle function definitions with support for multiple keywords:

- **Type Signature Completion**: After typing `fun`, `function`, `primrec`, `definition`, `primcorec`, or `corec` followed by `::` and space, automatically suggests completing with `" ⇒ " where`
- **Function Body Completion**: After the `where` keyword, pressing Enter provides smart completion:
  - Automatically uses `≡` for `definition` keyword, `=` for other function keywords
  - Supports multi-line function definitions with `|` prefix
  - Automatically handles indentation
  - Stops completion when pressing Enter on an empty line (double Enter)

**Example workflow**:
```isabelle
fun factorial :: "nat ⇒ nat" where
"factorial 0 = 1"
| "factorial (Suc n) = Suc n * factorial n"
```

#### 2. Theory Structure Auto-Completion

Streamlines the creation of new Isabelle theory files:

- **Theory Declaration**: At the beginning of a file, (enter a space then) automatically suggests `theory FileName` (extracts filename automatically)
- **Imports Section**: After the theory line, suggests `imports`
- **Begin Keyword**: After the imports line, suggests `begin`

**Example workflow**:
```isabelle
theory MyTheory
imports Main
begin
```

#### 3. Proof Outline Auto-Completion

Automatically extracts and suggests proof frameworks from Isabelle output:

- **Automatic Extraction**: Monitors Isabelle output for "Proof outline with cases:" messages
- **Smart Indentation**: Inherits indentation from the `proof` line and adds 2 extra spaces to the first line
- **Interactive Navigation**: Converts all `sorry` placeholders to tab stops for easy navigation
- **Case Support**: Works after both `proof` and `case` statements

**Example**:
When Isabelle shows a proof outline, typing `proof -` and pressing Enter will automatically insert:
```isabelle
proof -
  case goal1
  then show ?case sorry
next
  case goal2
  then show ?case sorry
qed
```

#### 4. Fix/Assume Statement Auto-Completion

Intelligently generates `fix` and `assume` statements from goal structures:

- **Simple Goals**: For goals like `1. assumption ⟹ conclusion`, suggests `assume "assumption"`
- **Quantified Goals**: For goals like `⋀x y. assumption ⟹ conclusion`, suggests:
  ```isabelle
  fix x y
  assume "assumption"
  ```
- **Context-Aware**: Works after `proof`, `case`, and `next` keywords
- **Single Implication**: Only triggers when the goal has exactly one `⟹` symbol

#### 5. Symbol Conversion Tool

One-click conversion from Isabelle ASCII notation to Unicode symbols:

- **Toolbar Button**: Adds a button in the VSCode editor toolbar (only visible for `.thy` files)
- **Batch Conversion**: Converts all `\<symbol>` format to Unicode in the entire file
- **Comprehensive Mapping**: Uses the complete symbol mapping from `isabelle-snippets`
- **Feedback**: Shows the number of symbols converted

**Examples**:
- `\<Rightarrow>` → `⇒`
- `\<forall>` → `∀`
- `\<exists>` → `∃`
- `\<and>` → `∧`
- `\<or>` → `∨`

#### 6. Automatic Workspace Snippets Setup

Automatically configures code snippets for your workspace:

- **First-Time Setup**: On extension activation, automatically copies `isabelle.code-snippets` to workspace `.vscode` folder
- **Non-Destructive**: Won't overwrite existing snippet files
- **Instant Availability**: All Isabelle symbol snippets become immediately available in your project

#### 7. Enhanced Editor Configuration

Optimized editor settings for Isabelle development:

- **String Completions**: Enables auto-completion inside double-quoted strings
- **UTF8 Isabelle Encoding**: Automatically uses the correct encoding for `.thy` files

### Installation

1. Clone or download this repository
2. Run the compile steps (see below)
3. Install the generated `.vsix` file in VSCode

### Usage Tips

- Press `Tab` to navigate between snippet placeholders
- The proof outline and fix/assume completions are context-aware and position-dependent

---

## 中文说明

### 功能特性

#### 1. 函数定义自动补全

为 Isabelle 函数定义提供智能自动补全，支持多种关键字：

- **类型签名补全**：在输入 `fun`、`function`、`primrec`、`definition`、`primcorec` 或 `corec` 后跟 `::` 和空格时，自动建议补全为 `" ⇒ " where`
- **函数体补全**：在 `where` 关键字后按回车，提供智能补全：
  - 对 `definition` 关键字自动使用 `≡`，其他函数关键字使用 `=`
  - 支持多行函数定义，自动添加 `|` 前缀
  - 自动处理缩进
  - 在空行按回车（双回车）时停止补全

**示例流程**：
```isabelle
fun factorial :: "nat ⇒ nat" where
"factorial 0 = 1"
| "factorial (Suc n) = Suc n * factorial n"
```

#### 2. Theory 结构自动补全

简化新 Isabelle 理论文件的创建：

- **Theory 声明**：在文件开头（按一个空格后）自动建议 `theory 文件名`（自动提取文件名）
- **Imports 部分**：在 theory 行之后建议 `imports`
- **Begin 关键字**：在 imports 行之后建议 `begin`

**示例流程**：
```isabelle
theory MyTheory
imports Main
begin
```

#### 3. Proof Outline 自动补全

从 Isabelle 输出中自动提取并建议证明框架：

- **自动提取**：监控 Isabelle 输出中的 "Proof outline with cases:" 消息
- **智能缩进**：继承 `proof` 行的缩进，并为第一行额外添加 2 个空格
- **交互式导航**：将所有 `sorry` 占位符转换为制表位，方便快速跳转
- **Case 支持**：在 `proof` 和 `case` 语句后都能工作

**示例**：
当 Isabelle 显示证明大纲时，输入 `proof -` 并按回车将自动插入：
```isabelle
proof -
  case goal1
  then show ?case sorry
next
  case goal2
  then show ?case sorry
qed
```

#### 4. Fix/Assume 语句自动补全

从目标结构智能生成 `fix` 和 `assume` 语句：

- **简单目标**：对于 `1. assumption ⟹ conclusion` 形式的目标，建议 `assume "assumption"`
- **量化目标**：对于 `⋀x y. assumption ⟹ conclusion` 形式的目标，建议：
  ```isabelle
  fix x y
  assume "assumption"
  ```
- **上下文感知**：在 `proof`、`case` 和 `next` 关键字后工作
- **单一蕴含**：仅在目标包含恰好一个 `⟹` 符号时触发

#### 5. 符号转换工具

一键将 Isabelle ASCII 记法转换为 Unicode 符号：

- **工具栏按钮**：在 VSCode 编辑器工具栏添加按钮（仅对 `.thy` 文件可见）
- **批量转换**：转换整个文件中的所有 `\<symbol>` 格式为 Unicode
- **全面映射**：使用 `isabelle-snippets` 中的完整符号映射
- **反馈提示**：显示转换的符号数量

**示例**：
- `\<Rightarrow>` → `⇒`
- `\<forall>` → `∀`
- `\<exists>` → `∃`
- `\<and>` → `∧`
- `\<or>` → `∨`

#### 6. 自动工作区 Snippets 配置

自动为工作区配置代码片段：

- **首次配置**：插件激活时自动将 `isabelle.code-snippets` 复制到工作区的 `.vscode` 文件夹
- **非破坏性**：不会覆盖已存在的片段文件
- **即时可用**：所有 Isabelle 符号片段立即在项目中可用

#### 7. 增强的编辑器配置

为 Isabelle 开发优化的编辑器设置：

- **字符串补全**：在双引号字符串内启用自动补全
- **UTF8 Isabelle 编码**：自动为 `.thy` 文件使用正确的编码

### 安装方法

1. 克隆或下载此仓库
2. 运行编译步骤（见下方）
3. 在 VSCode 中安装生成的 `.vsix` 文件

### 使用提示

- 按 `Tab` 键在片段占位符之间导航
- Proof outline 和 fix/assume 补全是上下文感知和位置相关的

---

## Source Code

https://github.com/ponder-j/Isabelle-Vscode

### Compile Steps

```powershell
npm install
npm run compile
npm install -g @vscode/vsce
vsce package
```

