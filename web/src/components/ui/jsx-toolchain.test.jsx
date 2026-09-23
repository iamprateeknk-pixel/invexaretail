import assert from 'node:assert/strict';
import test from 'node:test';
import 'global-jsdom/register';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Button } from './button.jsx';

test('jsx + jsdom + testing-library toolchain can render a real existing component', () => {
  render(React.createElement(Button, null, 'Click me'));
  const button = screen.getByRole('button', { name: 'Click me' });
  assert.ok(button);
});
