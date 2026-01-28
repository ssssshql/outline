<p align="center">
  <img src="https://user-images.githubusercontent.com/31465/34380645-bd67f474-eb0b-11e7-8d03-0151c1730654.png" height="29" />
</p>
<p align="center">
  <i>一个快速、协作的知识库，专为您的团队构建，使用 React 和 Node.js。<br/>您可以尝试我们托管版本的 Outline，网址为 <a href="https://www.getoutline.com">www.getoutline.com</a>。</i>
  <br/>
  <img width="1640" alt="screenshot" src="https://user-images.githubusercontent.com/380914/110356468-26374600-7fef-11eb-9f6a-f2cc2c8c6590.png">
</p>
<p align="center">
  <a href="http://www.typescriptlang.org" rel="nofollow"><img src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg" alt="TypeScript"></a>
  <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat" alt="Prettier"></a>
  <a href="https://github.com/styled-components/styled-components"><img src="https://img.shields.io/badge/style-%F0%9F%92%85%20styled--components-orange.svg" alt="Styled Components"></a>
  <a href="https://translate.getoutline.com/project/outline" alt="Localized"><img src="https://badges.crowdin.net/outline/localized.svg"></a>
</p>

这是运行 [**Outline**](https://www.getoutline.com) 及其所有相关服务的源代码。如果您想使用 Outline，则无需运行此代码，我们在 [getoutline.com](https://www.getoutline.com) 提供了托管版本的应用程序。您还可以在 [我们的指南](https://docs.getoutline.com/s/guide) 中找到关于如何使用 Outline 的文档。

如果您想运行自己的 Outline 副本或为开发做贡献，那么这里就是您的最佳选择。

# 安装

请参阅 [文档](https://docs.getoutline.com/s/hosting/) 了解如何在生产环境中运行自己的 Outline 副本。

如果您对文档有任何疑问或改进建议，请在 [GitHub 讨论区](https://github.com/outline/outline/discussions) 创建一个话题。

# 开发

如果您希望为 Outline 贡献更改、修复和改进，可以参考 [设置开发环境的简短指南](https://docs.getoutline.com/s/hosting/doc/local-development-5hEhFRXow7)。

## 贡献

Outline 是由一个小团队构建和维护的——我们非常希望您能帮助修复错误并添加功能！

在提交拉取请求之前，请通过在 [GitHub](https://www.github.com/outline/outline/issues) 上创建或评论问题与核心团队讨论——我们也希望在 [讨论区](https://www.github.com/outline/outline/discussions) 听到您的声音。这样我们可以确保在编写代码之前就达成一致的方法。这将大大提高您的代码被接受的可能性。

如果您正在寻找开始的方式，以下是我们改进 Outline 的一些方法列表：

- [翻译](docs/TRANSLATION.md) 成其他语言
- 标有 [`good first issue`](https://github.com/outline/outline/labels/good%20first%20issue) 的问题
- 性能改进，包括服务器端和前端
- 开发者体验和文档
- GitHub 上列出的错误和其他问题

## 架构

如果您有兴趣为 Outline 贡献代码或了解更多关于 Outline 代码库的信息，
请先参考 [架构文档](docs/ARCHITECTURE.md)，它提供了应用程序如何组合在一起的高级概述。

## 调试

在开发中，Outline 将简单的日志输出到控制台，并以类别作为前缀。在生产环境中，它输出 JSON 日志，这些日志可以轻松地由您首选的日志处理管道解析。

HTTP 日志记录默认是禁用的，但可以通过设置 `DEBUG=http` 环境变量来启用。可以通过设置 `DEBUG=*` 来启用所有类别的日志记录，或者针对特定类别如 `DEBUG=database` 和 `LOG_LEVEL=debug`，或者 `LOG_LEVEL=silly` 来进行非常详细的日志记录。

## 测试

我们的目标是对应用程序的关键部分有足够的测试覆盖，而不是追求 100% 的单元测试覆盖率。所有 API 端点和任何与身份验证相关的内容都应该经过充分测试。

要添加新测试，请使用 [Jest](https://facebook.github.io/jest/) 编写测试，并在被测试代码旁边添加带有 `.test.ts` 扩展名的文件。

```shell
# 运行所有测试
make test

# 在监视模式下运行后端测试
make watch
```

一旦使用 `make test` 创建了测试数据库，您可以直接使用 Jest 单独运行前端和后端测试：

```shell
# 运行后端测试
yarn test:server

# 在监视模式下运行特定的后端测试
yarn test path/to/file.test.ts --watch

# 运行前端测试
yarn test:app
```

## 迁移

使用 Sequelize 创建和运行迁移，例如：

```shell
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback
```

或者，在测试数据库上运行迁移：

```shell
yarn db:migrate --env test
```

## 自定义功能

本仓库的特殊版本已添加了 RAG（检索增强生成）功能，增强了知识库的智能搜索和问答能力。

## Windows 支持

本仓库的代码已修改，可以在 Windows 环境下编译和运行（需要 Git Bash）。

## Docker 部署

定制版本的 Docker 镜像已上传至 Docker Hub：https://hub.docker.com/r/ssssshql/outline

**重要提示**：由于需要存储向量数据，PostgreSQL 数据库必须使用 `pgvector/pgvector:pg18` 镜像，而不是标准的 PostgreSQL 镜像。

# 许可证

Outline 使用 [BSL 1.1 许可证](LICENSE)。