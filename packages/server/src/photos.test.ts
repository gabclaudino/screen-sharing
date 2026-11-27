import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProfilePhotos } from './photos';

describe('listProfilePhotos', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'screenshare-photos-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const add = (...files: string[]) => {
    for (const file of files) writeFileSync(path.join(dir, file), 'x');
  };

  it('lista só perfil-N de imagem, em ordem numérica', async () => {
    add('perfil-10.png', 'perfil-2.webp', 'perfil-1.JPG', 'guri-1.jpg', 'nao-clique.png');
    add('perfil-3.gif', 'perfil-x.png', 'perfil-4.png.txt', 'meu-perfil-5.png');
    mkdirSync(path.join(dir, 'perfil-6.png'));

    expect(await listProfilePhotos(dir)).toEqual([
      { id: 'perfil-1', file: 'perfil-1.JPG' },
      { id: 'perfil-2', file: 'perfil-2.webp' },
      { id: 'perfil-10', file: 'perfil-10.png' },
    ]);
  });

  it('um número só aparece uma vez', async () => {
    add('perfil-7.png', 'perfil-7.jpg', 'perfil-07.webp');
    expect(await listProfilePhotos(dir)).toEqual([{ id: 'perfil-7', file: 'perfil-07.webp' }]);
  });

  it('um arquivo novo aparece na próxima leitura; pasta ausente é lista vazia', async () => {
    expect(await listProfilePhotos(dir)).toEqual([]);
    add('perfil-19.jpeg');
    expect(await listProfilePhotos(dir)).toHaveLength(1);
    expect(await listProfilePhotos(path.join(dir, 'nao-existe'))).toEqual([]);
  });
});
