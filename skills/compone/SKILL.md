---
name: compone
description: Builds Python components using the compone framework for type-safe HTML/XML/RSS generation. Use when working with compone, creating Python components, generating markup in Python, or building framework-agnostic component libraries.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch
---

# Compone - Python Component Framework

Helps developers create type-safe, reusable components using compone, a modern
Python framework for generating markup (HTML, XML, RSS) with React-like patterns.

ALWAYS read `core-concepts.md` for basic usage.

- For integration with web frameworks, read [`frameworks.md`](frameworks.md).
- For HTML generation and patterns, read [`html.md`](html.md)
- For other formats like XML, RSS, SVG and others, read [`other-formats.md`](other-formats.md)
- For more examples when writing complex components, read [`other-formats.md`](examples.md)
- When writing tests for Components, read [`testing.md`](testing.md)

## When to Use Compone

- Building framework-agnostic component libraries
- Type-safe HTML generation in Python
- Colocating markup with Python logic
- Generating XML, RSS, or other markup formats
- Creating reusable UI patterns across projects
- Teams preferring Python over template languages


## Best Practices

1. **Type all props**: Use type hints for better IDE support and static type checking
2. **Single responsibility**: Keep components focused on one concern
3. **Composition over complexity**: Build complex UIs from simple components
4. **Descriptive names**: Use clear component and prop names
5. **Default values**: Provide sensible defaults for optional props
6. **Framework agnostic**: Don't tie components to specific web frameworks


## Official Documentation

- Website: https://compone.kissgyorgy.me/
- GitHub: https://github.com/kissgyorgy/compone
- PyPI: https://pypi.org/project/compone/
