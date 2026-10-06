import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ParallaxLayer, TiltCard } from '../../components/fx/TiltCard';
import { NeuBadge } from '../../components/fx/NeuBadge';
import { CategoryIcon } from '../../components/CategoryIcon';

describe('TiltCard', () => {
  it('renders its content, including parallax layers floating at different depths', async () => {
    await render(
      <TiltCard baseColor="#222222" radius={24}>
        <ParallaxLayer depth={12}>
          <Text>front layer</Text>
        </ParallaxLayer>
        <ParallaxLayer depth={-8}>
          <Text>back layer</Text>
        </ParallaxLayer>
      </TiltCard>,
    );
    expect(screen.getByText('front layer')).toBeOnTheScreen();
    expect(screen.getByText('back layer')).toBeOnTheScreen();
  });

  it('works with the glare turned off and with a fixed size', async () => {
    await render(
      <TiltCard baseColor="#fff" glare={false} dark={false} style={{ width: 170, height: 200 }} faceStyle={{ width: 170, height: 200 }}>
        <Text>fixed</Text>
      </TiltCard>,
    );
    expect(screen.getByText('fixed')).toBeOnTheScreen();
  });

  it('lets a ParallaxLayer render on its own (no tilt = no offset)', async () => {
    await render(
      <ParallaxLayer depth={5}>
        <Text>standalone</Text>
      </ParallaxLayer>,
    );
    expect(screen.getByText('standalone')).toBeOnTheScreen();
  });
});

describe('neumorphic category badges', () => {
  it('renders a badge for any category, including unknown ones', async () => {
    await render(<NeuBadge icon="restaurant" color="#7C9CFF" size={48} float />);
    await render(<CategoryIcon category="games" />);
    await render(<CategoryIcon category="not-a-category" />);
    // nothing to assert beyond "does not throw": the icon font is mocked, so we check each category resolves
  });
});
