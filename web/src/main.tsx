import ViewerApp from './ViewerApp';
import { mountApp } from './mountApp';
import { recordPageVisit } from './services/visitStatisticsClient';

mountApp(<ViewerApp />);
void recordPageVisit();
