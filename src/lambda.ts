import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IWatchful } from './api';
import { LambdaMetricFactory } from './monitoring/aws/lambda/metrics';

const DEFAULT_DURATION_THRESHOLD_PERCENT = 80;

export interface WatchLambdaFunctionOptions {
  /**
   * Number of allowed errors per minute. If there are more errors than that, an alarm will trigger.
   *
   * @default 0
   */
  readonly errorsPerMinuteThreshold?: number;

  /**
   * Number of allowed throttles per minute.
   *
   * @default 0
   */
  readonly throttlesPerMinuteThreshold?: number;

  /**
   * Threshold for the duration alarm as percentage of the function's timeout
   * value.
   *
   * If this is set to 50%, the alarm will be set when p99 latency of the
   * function exceeds 50% of the function's timeout setting.
   *
   * @default 80
   */
  readonly durationThresholdPercent?: number;

  /**
   * Number of periods to evaluate for the errors alarms.
   *
   * @default 3
   */
  readonly errorsEvaluationPeriods?: number;

  /**
   * Number of periods to evaluate for the throttles alarms.
   *
   * @default 3
   */
  readonly throttlesEvaluationPeriods?: number;

  /**
   * Number of periods to evaluate for the duration alarms.
   *
   * @default 3
   */
  readonly durationEvaluationPeriods?: number;
}

export interface WatchLambdaFunctionProps extends WatchLambdaFunctionOptions {
  readonly title: string;
  readonly watchful: IWatchful;
  readonly fn: lambda.Function;
}

export class WatchLambdaFunction extends Construct {
  private readonly watchful: IWatchful;
  private readonly fn: lambda.Function;
  private readonly metrics: LambdaMetricFactory;

  constructor(scope: Construct, id: string, props: WatchLambdaFunctionProps) {
    super(scope, id);

    const cfnFunction = props.fn.node.defaultChild as lambda.CfnFunction;
    const timeoutSec = cfnFunction.timeout || 3;

    this.watchful = props.watchful;
    this.fn = props.fn;
    this.metrics = new LambdaMetricFactory();

    this.watchful.addSection(props.title, {
      links: [
        { title: 'AWS Lambda Console', url: linkForLambdaFunction(this.fn) },
        { title: 'CloudWatch Logs', url: linkForLambdaLogs(this.fn) },
      ],
    });

    const { errorsMetric, errorsAlarm } = this.createErrorsMonitor(
      props.errorsPerMinuteThreshold,
      props.errorsEvaluationPeriods,
    );
    const { throttlesMetric, throttlesAlarm } = this.createThrottlesMonitor(
      props.throttlesPerMinuteThreshold,
      props.throttlesEvaluationPeriods,
    );
    const { durationMetric, durationAlarm } = this.createDurationMonitor(
      timeoutSec,
      props.durationThresholdPercent,
      props.durationEvaluationPeriods,
    );
    const invocationsMetric = this.metrics.metricInvocations(
      this.fn.functionName,
    );

    this.watchful.addWidgets(
      new cloudwatch.GraphWidget({
        title: `Invocations/${invocationsMetric.period.toMinutes()}min`,
        width: 6,
        left: [invocationsMetric],
      }),
      new cloudwatch.GraphWidget({
        title: `Errors/${errorsMetric.period.toMinutes()}min`,
        width: 6,
        left: [errorsMetric],
        leftAnnotations: [errorsAlarm.toAnnotation()],
      }),
      new cloudwatch.GraphWidget({
        title: `Throttles/${throttlesMetric.period.toMinutes()}min`,
        width: 6,
        left: [throttlesMetric],
        leftAnnotations: [throttlesAlarm.toAnnotation()],
      }),
      new cloudwatch.GraphWidget({
        title: `Duration/${durationMetric.period.toMinutes()}min`,
        width: 6,
        left: [durationMetric],
        leftAnnotations: [durationAlarm.toAnnotation()],
      }),
    );
  }

  private createErrorsMonitor(
    errorsPerMinuteThreshold = 0,
    evaluationPeriods = 3,
  ) {
    const fn = this.fn;
    const errorsMetric = this.metrics.metricErrors(fn.functionName);
    const errorsAlarm = errorsMetric.createAlarm(this, 'ErrorsAlarm', {
      alarmDescription: `Over ${errorsPerMinuteThreshold} errors per minute`,
      threshold: errorsPerMinuteThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods,
    });
    this.watchful.addAlarm(errorsAlarm);
    return { errorsMetric, errorsAlarm };
  }

  private createThrottlesMonitor(
    throttlesPerMinuteThreshold = 0,
    evaluationPeriods = 3,
  ) {
    const fn = this.fn;
    const throttlesMetric = this.metrics.metricThrottles(fn.functionName);
    const throttlesAlarm = throttlesMetric.createAlarm(this, 'ThrottlesAlarm', {
      alarmDescription: `Over ${throttlesPerMinuteThreshold} throttles per minute`,
      threshold: throttlesPerMinuteThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods,
    });
    this.watchful.addAlarm(throttlesAlarm);
    return { throttlesMetric, throttlesAlarm };
  }

  private createDurationMonitor(
    timeoutSec: number,
    durationPercentThreshold: number = DEFAULT_DURATION_THRESHOLD_PERCENT,
    evaluationPeriods = 3,
  ) {
    const fn = this.fn;
    const durationMetric = this.metrics.metricDuration(fn.functionName).p99;
    const durationThresholdSec = Math.floor(
      (durationPercentThreshold / 100) * timeoutSec,
    );
    const durationAlarm = durationMetric.createAlarm(this, 'DurationAlarm', {
      alarmDescription: `p99 latency >= ${durationThresholdSec}s (${durationPercentThreshold}%)`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: durationThresholdSec * 1000, // milliseconds
      evaluationPeriods,
    });
    this.watchful.addAlarm(durationAlarm);
    return { durationMetric, durationAlarm };
  }
}

function linkForLambdaFunction(fn: lambda.Function, tab = 'graph') {
  return `https://console.aws.amazon.com/lambda/home?region=${fn.stack.region}#/functions/${fn.functionName}?tab=${tab}`;
}

function linkForLambdaLogs(fn: lambda.Function) {
  return `https://console.aws.amazon.com/cloudwatch/home?region=${fn.stack.region}#logEventViewer:group=/aws/lambda/${fn.functionName}`;
}
