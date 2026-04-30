export function NowPlayingIndicator(props: { size?: number }) {
  const s = () => props.size ?? 16;
  return (
    <div class="now-playing" style={{ width: `${s()}px`, height: `${s()}px` }}>
      <span class="bar" /><span class="bar" /><span class="bar" />
    </div>
  );
}
